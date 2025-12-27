import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { getDb } from '../lib/db.js';

const TelemetryEventSchema = z.object({
  report_id: z.string(),
  event_type: z.enum(['open', 'close', 'dwell', 'scroll', 'click', 'pin']),
  event_data_json: z.string().optional(),
});

const FeedbackSchema = z.object({
  report_id: z.string(),
  action: z.string(),
  comment: z.string().optional(),
});

export async function telemetryRoutes(app: FastifyInstance) {
  const db = getDb();

  // POST /telemetry
  app.post('/telemetry', async (request) => {
    const body = TelemetryEventSchema.parse(request.body);
    const id = randomUUID().replace(/-/g, '');

    db.prepare(`
      INSERT INTO telemetry (id, report_id, event_type, event_data_json)
      VALUES (?, ?, ?, ?)
    `).run(id, body.report_id, body.event_type, body.event_data_json || '{}');

    return { id };
  });

  // POST /telemetry/batch
  app.post('/telemetry/batch', async (request) => {
    const body = request.body as { events: z.infer<typeof TelemetryEventSchema>[] };
    let count = 0;

    const insertMany = db.transaction((events: typeof body.events) => {
      const stmt = db.prepare(`
        INSERT INTO telemetry (id, report_id, event_type, event_data_json)
        VALUES (?, ?, ?, ?)
      `);

      for (const event of events) {
        const parsed = TelemetryEventSchema.parse(event);
        const id = randomUUID().replace(/-/g, '');
        stmt.run(id, parsed.report_id, parsed.event_type, parsed.event_data_json || '{}');
        count++;
      }
    });

    insertMany(body.events);
    return { count };
  });

  // POST /feedback
  app.post('/feedback', async (request) => {
    const body = FeedbackSchema.parse(request.body);
    const id = randomUUID().replace(/-/g, '');

    db.prepare(`
      INSERT INTO feedback (id, report_id, action, comment)
      VALUES (?, ?, ?, ?)
    `).run(id, body.report_id, body.action, body.comment || null);

    // Update UI action stats
    db.prepare(`
      UPDATE ui_action_stats
      SET clicked_count = clicked_count + 1,
          last_clicked_at = datetime('now'),
          updated_at = datetime('now')
      WHERE action = ?
    `).run(body.action);

    return { id };
  });

  // GET /ui-actions - Get enabled feedback actions
  app.get('/ui-actions', async () => {
    const actions = db.prepare(`
      SELECT action, enabled, shown_count, clicked_count, success_rate
      FROM ui_action_stats
      WHERE enabled = 1
      ORDER BY success_rate DESC
    `).all();
    return { actions };
  });

  // POST /ui-actions/:action/shown
  app.post('/ui-actions/:action/shown', async (request) => {
    const { action } = request.params as { action: string };
    db.prepare(`
      UPDATE ui_action_stats
      SET shown_count = shown_count + 1,
          last_shown_at = datetime('now'),
          updated_at = datetime('now')
      WHERE action = ?
    `).run(action);
    return { success: true };
  });

  // GET /telemetry/stats/:report_id
  app.get('/telemetry/stats/:report_id', async (request) => {
    const { report_id } = request.params as { report_id: string };

    const stats = db.prepare(`
      SELECT
        event_type,
        COUNT(*) as count,
        MAX(created_at) as last_at
      FROM telemetry
      WHERE report_id = ?
      GROUP BY event_type
    `).all(report_id);

    return { report_id, stats };
  });

  // POST /ui-actions/prune - Run bandit pruning algorithm
  app.post('/ui-actions/prune', async () => {
    const MIN_SAMPLES = 20; // Minimum samples before pruning
    const TOP_K = 2; // Keep top K actions always enabled
    const EXPLORATION_RATE = 0.1; // Chance to re-enable a disabled action

    // Get all actions with enough data
    const actions = db.prepare(`
      SELECT action, enabled, shown_count, clicked_count, success_rate
      FROM ui_action_stats
      WHERE shown_count >= ?
      ORDER BY success_rate DESC
    `).all(MIN_SAMPLES) as Array<{
      action: string;
      enabled: number;
      shown_count: number;
      clicked_count: number;
      success_rate: number;
    }>;

    if (actions.length < 3) {
      return { pruned: 0, reactivated: 0, message: 'Not enough data for pruning' };
    }

    let pruned = 0;
    let reactivated = 0;

    // Prune bottom performers (keep top K)
    const topK = actions.slice(0, TOP_K);
    const rest = actions.slice(TOP_K);

    for (const action of rest) {
      if (action.enabled === 1) {
        // Disable low performers
        db.prepare('UPDATE ui_action_stats SET enabled = 0 WHERE action = ?').run(action.action);
        pruned++;
      } else if (Math.random() < EXPLORATION_RATE) {
        // Occasionally re-enable for exploration (epsilon-greedy)
        db.prepare('UPDATE ui_action_stats SET enabled = 1, shown_count = 0, clicked_count = 0 WHERE action = ?').run(action.action);
        reactivated++;
      }
    }

    // Ensure top K are always enabled
    for (const action of topK) {
      if (action.enabled === 0) {
        db.prepare('UPDATE ui_action_stats SET enabled = 1 WHERE action = ?').run(action.action);
        reactivated++;
      }
    }

    return { pruned, reactivated, topActions: topK.map(a => a.action) };
  });

  // POST /ui-actions/expand - Re-expand when satisfaction drops
  app.post('/ui-actions/expand', async () => {
    // Re-enable all actions for exploration
    const result = db.prepare(`
      UPDATE ui_action_stats
      SET enabled = 1, shown_count = 0, clicked_count = 0
      WHERE enabled = 0
    `).run();

    return { reactivated: result.changes };
  });

  // ============================================
  // PREFERENCE WEIGHT UPDATES
  // ============================================

  // POST /preferences/update-from-engagement
  // Updates concept, host, and report_type weights based on telemetry
  app.post('/preferences/update-from-engagement', async () => {
    const ENGAGEMENT_BOOST = 0.1;
    const DECAY_RATE = 0.95;
    const MIN_WEIGHT = 0.1;
    const MAX_WEIGHT = 10.0;

    let conceptUpdates = 0;
    let hostUpdates = 0;
    let typeUpdates = 0;

    // Get recent high-engagement reports (last 24h with meaningful interaction)
    const engagedReports = db.prepare(`
      SELECT DISTINCT r.id, r.type, r.concept_ids_json,
        (SELECT host FROM sources WHERE id = r.source_id) as host,
        (SELECT COUNT(*) FROM telemetry t WHERE t.report_id = r.id AND t.event_type IN ('dwell', 'click', 'pin')) as engagement_count
      FROM reports r
      WHERE EXISTS (
        SELECT 1 FROM telemetry t
        WHERE t.report_id = r.id
        AND t.created_at > datetime('now', '-24 hours')
        AND t.event_type IN ('dwell', 'click', 'pin')
      )
    `).all() as Array<{
      id: string;
      type: string;
      concept_ids_json: string;
      host: string | null;
      engagement_count: number;
    }>;

    // Update weights for each engaged report
    for (const report of engagedReports) {
      const boost = Math.min(report.engagement_count * ENGAGEMENT_BOOST, 1.0);

      // Update report type weight
      db.prepare(`
        INSERT INTO preference_weights (id, weight_type, target_id, weight, last_engagement_at)
        VALUES (lower(hex(randomblob(16))), 'report_type', ?, 1.0 + ?, datetime('now'))
        ON CONFLICT(weight_type, target_id) DO UPDATE SET
          weight = MIN(?, MAX(?, weight + ?)),
          last_engagement_at = datetime('now'),
          updated_at = datetime('now')
      `).run(report.type, boost, MAX_WEIGHT, MIN_WEIGHT, boost);
      typeUpdates++;

      // Update host weight
      if (report.host) {
        db.prepare(`
          INSERT INTO preference_weights (id, weight_type, target_id, weight, last_engagement_at)
          VALUES (lower(hex(randomblob(16))), 'host', ?, 1.0 + ?, datetime('now'))
          ON CONFLICT(weight_type, target_id) DO UPDATE SET
            weight = MIN(?, MAX(?, weight + ?)),
            last_engagement_at = datetime('now'),
            updated_at = datetime('now')
        `).run(report.host, boost, MAX_WEIGHT, MIN_WEIGHT, boost);
        hostUpdates++;
      }

      // Update concept weights
      try {
        const conceptIds = JSON.parse(report.concept_ids_json || '[]') as string[];
        for (const conceptId of conceptIds) {
          db.prepare(`
            INSERT INTO preference_weights (id, weight_type, target_id, weight, last_engagement_at)
            VALUES (lower(hex(randomblob(16))), 'concept', ?, 1.0 + ?, datetime('now'))
            ON CONFLICT(weight_type, target_id) DO UPDATE SET
              weight = MIN(?, MAX(?, weight + ?)),
              last_engagement_at = datetime('now'),
              updated_at = datetime('now')
          `).run(conceptId, boost, MAX_WEIGHT, MIN_WEIGHT, boost);
          conceptUpdates++;
        }
      } catch (e) {
        // Skip invalid JSON
      }
    }

    // Apply temporal decay to all weights not recently engaged
    const decayResult = db.prepare(`
      UPDATE preference_weights
      SET weight = MAX(?, weight * ?),
          updated_at = datetime('now')
      WHERE last_engagement_at < datetime('now', '-7 days')
        OR last_engagement_at IS NULL
    `).run(MIN_WEIGHT, DECAY_RATE);

    return {
      engaged_reports: engagedReports.length,
      concept_updates: conceptUpdates,
      host_updates: hostUpdates,
      type_updates: typeUpdates,
      decayed: decayResult.changes
    };
  });

  // GET /preferences/:type - Get weights for a type
  app.get('/preferences/:type', async (request) => {
    const { type } = request.params as { type: string };

    if (!['concept', 'host', 'report_type'].includes(type)) {
      return { error: 'Invalid type. Must be: concept, host, or report_type' };
    }

    const weights = db.prepare(`
      SELECT target_id, weight, last_engagement_at, updated_at
      FROM preference_weights
      WHERE weight_type = ?
      ORDER BY weight DESC
      LIMIT 100
    `).all(type);

    return { type, weights };
  });

  // ============================================
  // STOPPING POLICY - TELEMETRY ANALYSIS
  // ============================================

  // GET /telemetry/early-signals/:report_id
  // Extract features from first N seconds of engagement
  app.get('/telemetry/early-signals/:report_id', async (request) => {
    const { report_id } = request.params as { report_id: string };
    const EARLY_WINDOW_SECONDS = 10;

    // Get first engagement events
    const events = db.prepare(`
      SELECT event_type, event_data_json, created_at
      FROM telemetry
      WHERE report_id = ?
      ORDER BY created_at ASC
      LIMIT 20
    `).all(report_id) as Array<{
      event_type: string;
      event_data_json: string;
      created_at: string;
    }>;

    if (events.length === 0) {
      return { report_id, features: null, message: 'No telemetry data' };
    }

    const firstEvent = new Date(events[0].created_at).getTime();
    const earlyEvents = events.filter(e => {
      const t = new Date(e.created_at).getTime();
      return (t - firstEvent) <= EARLY_WINDOW_SECONDS * 1000;
    });

    // Extract features
    const features = {
      // Engagement signals
      opened: events.some(e => e.event_type === 'open'),
      time_to_close_ms: (() => {
        const open = events.find(e => e.event_type === 'open');
        const close = events.find(e => e.event_type === 'close');
        if (open && close) {
          return new Date(close.created_at).getTime() - new Date(open.created_at).getTime();
        }
        return null;
      })(),
      had_scroll: events.some(e => e.event_type === 'scroll'),
      had_click: events.some(e => e.event_type === 'click'),
      was_pinned: events.some(e => e.event_type === 'pin'),

      // Early signals (within first 10 seconds)
      early_scroll: earlyEvents.some(e => e.event_type === 'scroll'),
      early_click: earlyEvents.some(e => e.event_type === 'click'),
      early_event_count: earlyEvents.length,

      // Dwell time
      total_dwell_ms: events
        .filter(e => e.event_type === 'dwell')
        .reduce((sum, e) => {
          try {
            const data = JSON.parse(e.event_data_json || '{}');
            return sum + (data.duration_ms || 0);
          } catch { return sum; }
        }, 0),

      // Scroll depth
      max_scroll_depth: events
        .filter(e => e.event_type === 'scroll')
        .reduce((max, e) => {
          try {
            const data = JSON.parse(e.event_data_json || '{}');
            return Math.max(max, data.depth || 0);
          } catch { return max; }
        }, 0),
    };

    return { report_id, features };
  });

  // GET /telemetry/satisfaction-score/:report_id
  // Predict satisfaction based on engagement patterns
  app.get('/telemetry/satisfaction-score/:report_id', async (request) => {
    const { report_id } = request.params as { report_id: string };

    // Get engagement features
    const stats = db.prepare(`
      SELECT
        COUNT(*) as total_events,
        SUM(CASE WHEN event_type = 'open' THEN 1 ELSE 0 END) as opens,
        SUM(CASE WHEN event_type = 'click' THEN 1 ELSE 0 END) as clicks,
        SUM(CASE WHEN event_type = 'pin' THEN 1 ELSE 0 END) as pins,
        SUM(CASE WHEN event_type = 'scroll' THEN 1 ELSE 0 END) as scrolls,
        SUM(CASE WHEN event_type = 'dwell' THEN 1 ELSE 0 END) as dwells
      FROM telemetry
      WHERE report_id = ?
    `).get(report_id) as {
      total_events: number;
      opens: number;
      clicks: number;
      pins: number;
      scrolls: number;
      dwells: number;
    };

    // Get feedback
    const feedback = db.prepare(`
      SELECT action, COUNT(*) as count
      FROM feedback
      WHERE report_id = ?
      GROUP BY action
    `).all(report_id) as Array<{ action: string; count: number }>;

    // Calculate satisfaction score (0-1)
    let score = 0.5; // neutral baseline

    // Positive signals
    if (stats.pins > 0) score += 0.3;
    if (stats.clicks > 0) score += 0.1;
    if (stats.scrolls > 2) score += 0.05;
    if (stats.dwells > 3) score += 0.05;

    // Feedback adjustments
    for (const fb of feedback) {
      if (fb.action === 'useful') score += 0.2 * fb.count;
      if (fb.action === 'not_useful') score -= 0.3 * fb.count;
      if (fb.action === 'more_depth') score += 0.1 * fb.count;
      if (fb.action === 'kill_thread') score -= 0.4 * fb.count;
    }

    // Clamp to 0-1
    score = Math.max(0, Math.min(1, score));

    return {
      report_id,
      satisfaction_score: score,
      confidence: Math.min(stats.total_events / 10, 1), // Higher confidence with more events
      signals: {
        events: stats,
        feedback: feedback.reduce((acc, f) => ({ ...acc, [f.action]: f.count }), {}),
      }
    };
  });

  // GET /reports/:id/completeness
  // Check if report meets completeness criteria for stopping
  app.get('/reports/:id/completeness', async (request) => {
    const { id } = request.params as { id: string };

    const report = db.prepare(`
      SELECT type, title, summary, decision, findings_json, evidence_json,
             ui_blocks_json, concept_ids_json, cost_tokens, cost_dollars
      FROM reports WHERE id = ?
    `).get(id) as {
      type: string;
      title: string;
      summary: string | null;
      decision: string | null;
      findings_json: string;
      evidence_json: string;
      ui_blocks_json: string;
      concept_ids_json: string;
      cost_tokens: number;
      cost_dollars: number;
    } | undefined;

    if (!report) {
      return { error: 'Report not found' };
    }

    const findings = JSON.parse(report.findings_json || '[]');
    const evidence = JSON.parse(report.evidence_json || '[]');
    const uiBlocks = JSON.parse(report.ui_blocks_json || '[]');
    const concepts = JSON.parse(report.concept_ids_json || '[]');

    // Check completeness criteria
    const checks = {
      has_title: !!report.title,
      has_summary: !!report.summary && report.summary.length > 50,
      has_decision: report.type === 'decision_memo' ? !!report.decision : true,
      has_findings: findings.length >= 2,
      has_evidence: evidence.length >= 1,
      has_ui_blocks: uiBlocks.length >= 1,
      has_concepts: concepts.length >= 1,
    };

    const passedChecks = Object.values(checks).filter(Boolean).length;
    const totalChecks = Object.keys(checks).length;
    const completeness = passedChecks / totalChecks;

    return {
      report_id: id,
      completeness_score: completeness,
      checks,
      cost: {
        tokens: report.cost_tokens,
        dollars: report.cost_dollars,
      },
      should_stop: completeness >= 0.8,
    };
  });

  // GET /preferences/obsession-gradient
  // Returns the "obsession gradient" - concepts with rapidly increasing weight
  app.get('/preferences/obsession-gradient', async () => {
    // Get concepts with high recent engagement relative to baseline
    const gradient = db.prepare(`
      SELECT
        pw.target_id as concept_id,
        c.label as concept_label,
        pw.weight,
        pw.last_engagement_at,
        (SELECT COUNT(*) FROM telemetry t
         JOIN reports r ON t.report_id = r.id
         WHERE r.concept_ids_json LIKE '%' || pw.target_id || '%'
         AND t.created_at > datetime('now', '-7 days')) as recent_engagements,
        (SELECT COUNT(*) FROM telemetry t
         JOIN reports r ON t.report_id = r.id
         WHERE r.concept_ids_json LIKE '%' || pw.target_id || '%'
         AND t.created_at BETWEEN datetime('now', '-30 days') AND datetime('now', '-7 days')) as baseline_engagements
      FROM preference_weights pw
      LEFT JOIN concepts c ON pw.target_id = c.id
      WHERE pw.weight_type = 'concept'
        AND pw.weight > 1.5
      ORDER BY pw.weight DESC
      LIMIT 20
    `).all() as Array<{
      concept_id: string;
      concept_label: string | null;
      weight: number;
      last_engagement_at: string;
      recent_engagements: number;
      baseline_engagements: number;
    }>;

    // Calculate gradient (recent vs baseline ratio)
    const withGradient = gradient.map(g => ({
      ...g,
      gradient: g.baseline_engagements > 0
        ? g.recent_engagements / g.baseline_engagements
        : g.recent_engagements > 0 ? Infinity : 0
    })).sort((a, b) => (b.gradient === Infinity ? 1000 : b.gradient) - (a.gradient === Infinity ? 1000 : a.gradient));

    return {
      obsessions: withGradient.slice(0, 10),
      timestamp: new Date().toISOString()
    };
  });
}
