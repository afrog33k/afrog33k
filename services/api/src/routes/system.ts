import { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { getDb } from '../lib/db.js';

export async function systemRoutes(app: FastifyInstance) {
  const db = getDb();

  // GET /system/state/:key
  app.get('/system/state/:key', async (request) => {
    const { key } = request.params as { key: string };
    const row = db.prepare('SELECT value_json FROM system_state WHERE key = ?').get(key) as { value_json: string } | undefined;

    if (!row) {
      throw { statusCode: 404, message: 'Key not found' };
    }

    return { key, value: JSON.parse(row.value_json) };
  });

  // PUT /system/state/:key
  app.put('/system/state/:key', async (request) => {
    const { key } = request.params as { key: string };
    const body = request.body as { value: any };

    db.prepare(`
      INSERT INTO system_state (key, value_json) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = datetime('now')
    `).run(key, JSON.stringify(body.value));

    return { key, value: body.value };
  });

  // GET /system/stats
  app.get('/system/stats', async () => {
    const stats = {
      reports: (db.prepare('SELECT COUNT(*) as c FROM reports').get() as any).c,
      sources: (db.prepare('SELECT COUNT(*) as c FROM sources').get() as any).c,
      visits: (db.prepare('SELECT COUNT(*) as c FROM visits').get() as any).c,
      clusters: (db.prepare('SELECT COUNT(*) as c FROM visit_clusters').get() as any).c,
      concepts: (db.prepare('SELECT COUNT(*) as c FROM concepts WHERE active = 1').get() as any).c,
      pendingJobs: (db.prepare("SELECT COUNT(*) as c FROM job_queue WHERE status = 'pending'").get() as any).c,
    };

    return stats;
  });

  // GET /preference-weights
  app.get('/preference-weights', async (request) => {
    const query = request.query as Record<string, string>;
    const type = query.type;

    let sql = 'SELECT * FROM preference_weights';
    const params: any[] = [];

    if (type) {
      sql += ' WHERE weight_type = ?';
      params.push(type);
    }

    sql += ' ORDER BY weight DESC';
    const weights = db.prepare(sql).all(...params);
    return { weights };
  });

  // PUT /preference-weights
  app.put('/preference-weights', async (request) => {
    const body = request.body as {
      weight_type: string;
      target_id: string;
      weight: number;
    };

    const id = randomUUID().replace(/-/g, '');

    db.prepare(`
      INSERT INTO preference_weights (id, weight_type, target_id, weight, last_engagement_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(weight_type, target_id) DO UPDATE SET
        weight = excluded.weight,
        last_engagement_at = datetime('now'),
        updated_at = datetime('now')
    `).run(id, body.weight_type, body.target_id, body.weight);

    return { success: true };
  });

  // GET /system/satisfaction-stats
  // Returns satisfaction statistics for determining optimal stopping thresholds
  app.get('/system/satisfaction-stats', async (request) => {
    const query = request.query as Record<string, string>;
    const reportType = query.type;

    // Get reports with their satisfaction scores (based on feedback and engagement)
    let sql = `
      SELECT
        r.id,
        r.type,
        r.blended_score,
        (SELECT COUNT(*) FROM telemetry t WHERE t.report_id = r.id AND t.event_type = 'pin') as pins,
        (SELECT COUNT(*) FROM telemetry t WHERE t.report_id = r.id AND t.event_type = 'click') as clicks,
        (SELECT COUNT(*) FROM feedback f WHERE f.report_id = r.id AND f.action = 'useful') as useful_count,
        (SELECT COUNT(*) FROM feedback f WHERE f.report_id = r.id AND f.action = 'not_useful') as not_useful_count,
        CASE
          WHEN r.summary IS NOT NULL AND LENGTH(r.summary) > 50 THEN 1 ELSE 0
        END +
        CASE
          WHEN r.findings_json IS NOT NULL AND r.findings_json != '[]' THEN 1 ELSE 0
        END +
        CASE
          WHEN r.evidence_json IS NOT NULL AND r.evidence_json != '[]' THEN 1 ELSE 0
        END +
        CASE
          WHEN r.concept_ids_json IS NOT NULL AND r.concept_ids_json != '[]' THEN 1 ELSE 0
        END as completeness_factors
      FROM reports r
      WHERE r.archived = 0
    `;

    const params: any[] = [];
    if (reportType) {
      sql += ' AND r.type = ?';
      params.push(reportType);
    }

    const reports = db.prepare(sql).all(...params) as Array<{
      id: string;
      type: string;
      blended_score: number;
      pins: number;
      clicks: number;
      useful_count: number;
      not_useful_count: number;
      completeness_factors: number;
    }>;

    // Calculate satisfaction scores
    const scoredReports = reports.map(r => {
      let satisfaction = 0.5;
      if (r.pins > 0) satisfaction += 0.3;
      if (r.clicks > 0) satisfaction += 0.1;
      if (r.useful_count > 0) satisfaction += 0.2;
      if (r.not_useful_count > 0) satisfaction -= 0.3;
      satisfaction = Math.max(0, Math.min(1, satisfaction));

      const completeness = r.completeness_factors / 4;

      return { ...r, satisfaction, completeness };
    });

    // Find optimal completeness threshold
    // (completeness level where satisfaction is consistently high)
    const highSatisfaction = scoredReports.filter(r => r.satisfaction >= 0.7);
    const avgCompletenessForHighSat = highSatisfaction.length > 0
      ? highSatisfaction.reduce((sum, r) => sum + r.completeness, 0) / highSatisfaction.length
      : 0.8;

    return {
      sample_size: reports.length,
      report_type: reportType || 'all',
      avg_satisfaction: scoredReports.reduce((s, r) => s + r.satisfaction, 0) / (scoredReports.length || 1),
      avg_completeness: scoredReports.reduce((s, r) => s + r.completeness, 0) / (scoredReports.length || 1),
      optimal_completeness_threshold: Math.max(0.6, Math.min(0.95, avgCompletenessForHighSat)),
      high_satisfaction_count: highSatisfaction.length,
    };
  });

  // GET /system/cost-summary
  // Returns cost tracking summary
  app.get('/system/cost-summary', async () => {
    const summary = db.prepare(`
      SELECT
        SUM(cost_tokens) as total_tokens,
        SUM(cost_dollars) as total_dollars,
        COUNT(*) as total_reports,
        AVG(cost_tokens) as avg_tokens_per_report,
        AVG(cost_dollars) as avg_dollars_per_report,
        MAX(cost_tokens) as max_tokens,
        MAX(cost_dollars) as max_dollars
      FROM reports
      WHERE cost_tokens > 0 OR cost_dollars > 0
    `).get() as {
      total_tokens: number;
      total_dollars: number;
      total_reports: number;
      avg_tokens_per_report: number;
      avg_dollars_per_report: number;
      max_tokens: number;
      max_dollars: number;
    };

    // Get daily budget
    const budgetRow = db.prepare(
      "SELECT value_json FROM system_state WHERE key = 'budget_daily_dollars'"
    ).get() as { value_json: string } | undefined;

    const dailyBudget = budgetRow ? parseFloat(JSON.parse(budgetRow.value_json)) : 5.0;

    // Get today's spending
    const todaySpend = db.prepare(`
      SELECT SUM(cost_dollars) as spent
      FROM reports
      WHERE DATE(created_at) = DATE('now')
    `).get() as { spent: number | null };

    return {
      ...summary,
      daily_budget: dailyBudget,
      today_spent: todaySpend?.spent || 0,
      today_remaining: dailyBudget - (todaySpend?.spent || 0),
    };
  });
}
