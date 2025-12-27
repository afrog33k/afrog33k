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
}
