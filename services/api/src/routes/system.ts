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
}
