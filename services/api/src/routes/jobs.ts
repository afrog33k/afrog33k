import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { getDb } from '../lib/db.js';

const CreateJobSchema = z.object({
  job_type: z.enum(['ideation', 'research', 'synthesis', 'meta']),
  payload_json: z.string().optional(),
  priority: z.number().optional(),
});

export async function jobRoutes(app: FastifyInstance) {
  const db = getDb();

  // GET /jobs - List jobs
  app.get('/jobs', async (request) => {
    const query = request.query as Record<string, string>;
    const status = query.status;
    const limit = parseInt(query.limit || '50');

    let sql = 'SELECT * FROM job_queue';
    const params: any[] = [];

    if (status) {
      sql += ' WHERE status = ?';
      params.push(status);
    }

    sql += ' ORDER BY priority DESC, created_at ASC LIMIT ?';
    params.push(limit);

    const jobs = db.prepare(sql).all(...params);
    return { jobs };
  });

  // POST /jobs
  app.post('/jobs', async (request) => {
    const body = CreateJobSchema.parse(request.body);
    const id = randomUUID().replace(/-/g, '');

    db.prepare(`
      INSERT INTO job_queue (id, job_type, payload_json, priority)
      VALUES (?, ?, ?, ?)
    `).run(id, body.job_type, body.payload_json || '{}', body.priority || 0);

    return { id, job_type: body.job_type };
  });

  // POST /jobs/claim - Claim next pending job (for worker)
  app.post('/jobs/claim', async (request) => {
    const body = request.body as { job_types?: string[] };
    const types = body.job_types || ['ideation', 'research', 'synthesis', 'meta'];

    const placeholders = types.map(() => '?').join(',');

    const job = db.prepare(`
      SELECT * FROM job_queue
      WHERE status = 'pending' AND job_type IN (${placeholders})
      ORDER BY priority DESC, created_at ASC
      LIMIT 1
    `).get(...types);

    if (!job) {
      return { job: null };
    }

    // Mark as running
    db.prepare(`
      UPDATE job_queue
      SET status = 'running', started_at = datetime('now'), attempts = attempts + 1
      WHERE id = ?
    `).run((job as any).id);

    return { job };
  });

  // PATCH /jobs/:id/complete
  app.patch('/jobs/:id/complete', async (request) => {
    const { id } = request.params as { id: string };
    db.prepare(`
      UPDATE job_queue
      SET status = 'completed', completed_at = datetime('now')
      WHERE id = ?
    `).run(id);
    return { success: true };
  });

  // PATCH /jobs/:id/fail
  app.patch('/jobs/:id/fail', async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { error_message?: string };

    const job = db.prepare('SELECT attempts, max_attempts FROM job_queue WHERE id = ?').get(id) as any;

    if (job && job.attempts < job.max_attempts) {
      // Retry later
      db.prepare(`
        UPDATE job_queue
        SET status = 'pending', error_message = ?
        WHERE id = ?
      `).run(body.error_message || null, id);
    } else {
      // Permanently failed
      db.prepare(`
        UPDATE job_queue
        SET status = 'failed', completed_at = datetime('now'), error_message = ?
        WHERE id = ?
      `).run(body.error_message || null, id);
    }

    return { success: true };
  });

  // GET /jobs/stats
  app.get('/jobs/stats', async () => {
    const stats = db.prepare(`
      SELECT status, COUNT(*) as count
      FROM job_queue
      GROUP BY status
    `).all();

    return { stats };
  });
}
