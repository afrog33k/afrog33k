import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { getDb } from '../lib/db.js';

const CreateVisitSchema = z.object({
  url: z.string().url(),
  title: z.string().optional(),
  browser: z.enum(['safari', 'chrome']),
  visited_at: z.string(),
  duration_seconds: z.number().optional(),
});

const CreateClusterSchema = z.object({
  started_at: z.string(),
  ended_at: z.string(),
  urls_json: z.string(),
  stats_json: z.string(),
  burst_score: z.number().optional(),
  novelty_score: z.number().optional(),
});

export async function visitRoutes(app: FastifyInstance) {
  const db = getDb();

  // POST /visits/batch - Batch import visits
  app.post('/visits/batch', async (request) => {
    const body = request.body as { visits: z.infer<typeof CreateVisitSchema>[] };
    let added = 0;

    const insertMany = db.transaction((visits: typeof body.visits) => {
      const stmt = db.prepare(`
        INSERT INTO visits (id, url, title, host, browser, visited_at, duration_seconds)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (const visit of visits) {
        try {
          const parsed = CreateVisitSchema.parse(visit);
          const id = randomUUID().replace(/-/g, '');
          const host = new URL(parsed.url).hostname;

          stmt.run(
            id,
            parsed.url,
            parsed.title || null,
            host,
            parsed.browser,
            parsed.visited_at,
            parsed.duration_seconds || null
          );
          added++;
        } catch (err) {
          // Skip invalid entries
        }
      }
    });

    insertMany(body.visits);
    return { added };
  });

  // GET /visits - List visits with filters
  app.get('/visits', async (request) => {
    const query = request.query as Record<string, string>;
    const limit = parseInt(query.limit || '100');
    const offset = parseInt(query.offset || '0');
    const browser = query.browser;
    const since = query.since;
    const host = query.host;

    let sql = 'SELECT * FROM visits WHERE 1=1';
    const params: any[] = [];

    if (browser) {
      sql += ' AND browser = ?';
      params.push(browser);
    }
    if (since) {
      sql += ' AND visited_at >= ?';
      params.push(since);
    }
    if (host) {
      sql += ' AND host = ?';
      params.push(host);
    }

    sql += ' ORDER BY visited_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const visits = db.prepare(sql).all(...params);
    return { visits };
  });

  // GET /visits/hosts - Get host frequency
  app.get('/visits/hosts', async (request) => {
    const query = request.query as Record<string, string>;
    const since = query.since;
    const limit = parseInt(query.limit || '50');

    let sql = `
      SELECT host, COUNT(*) as count, MAX(visited_at) as last_visited
      FROM visits
    `;
    const params: any[] = [];

    if (since) {
      sql += ' WHERE visited_at >= ?';
      params.push(since);
    }

    sql += ' GROUP BY host ORDER BY count DESC LIMIT ?';
    params.push(limit);

    const hosts = db.prepare(sql).all(...params);
    return { hosts };
  });

  // POST /visits/clusters
  app.post('/visits/clusters', async (request) => {
    const body = CreateClusterSchema.parse(request.body);
    const id = randomUUID().replace(/-/g, '');

    db.prepare(`
      INSERT INTO visit_clusters (id, started_at, ended_at, urls_json, stats_json, burst_score, novelty_score)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      body.started_at,
      body.ended_at,
      body.urls_json,
      body.stats_json,
      body.burst_score || 0,
      body.novelty_score || 0
    );

    return { id };
  });

  // GET /visits/clusters
  app.get('/visits/clusters', async (request) => {
    const query = request.query as Record<string, string>;
    const limit = parseInt(query.limit || '20');
    const processed = query.processed;

    let sql = 'SELECT * FROM visit_clusters';
    const params: any[] = [];

    if (processed === 'true') {
      sql += ' WHERE processed_at IS NOT NULL';
    } else if (processed === 'false') {
      sql += ' WHERE processed_at IS NULL';
    }

    sql += ' ORDER BY intensity DESC, started_at DESC LIMIT ?';
    params.push(limit);

    const clusters = db.prepare(sql).all(...params);
    return { clusters };
  });

  // PATCH /visits/clusters/:id/mark-processed
  app.patch('/visits/clusters/:id/mark-processed', async (request) => {
    const { id } = request.params as { id: string };
    db.prepare('UPDATE visit_clusters SET processed_at = datetime("now") WHERE id = ?').run(id);
    return { success: true };
  });
}
