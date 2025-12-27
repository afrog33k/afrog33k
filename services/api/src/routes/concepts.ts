import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { getDb } from '../lib/db.js';

const CreateConceptSchema = z.object({
  label: z.string().min(1),
  description: z.string().optional(),
  parent_id: z.string().optional(),
});

export async function conceptRoutes(app: FastifyInstance) {
  const db = getDb();

  // GET /concepts
  app.get('/concepts', async (request) => {
    const query = request.query as Record<string, string>;
    const limit = parseInt(query.limit || '100');
    const active = query.active !== 'false';

    let sql = 'SELECT * FROM concepts WHERE active = ?';
    sql += ' ORDER BY mention_count DESC, label ASC LIMIT ?';

    const concepts = db.prepare(sql).all(active ? 1 : 0, limit);
    return { concepts };
  });

  // POST /concepts
  app.post('/concepts', async (request) => {
    const body = CreateConceptSchema.parse(request.body);
    const id = randomUUID().replace(/-/g, '');

    try {
      db.prepare(`
        INSERT INTO concepts (id, label, description, parent_id)
        VALUES (?, ?, ?, ?)
      `).run(id, body.label, body.description || null, body.parent_id || null);

      return { id, label: body.label };
    } catch (err: any) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        // Return existing concept
        const existing = db.prepare('SELECT * FROM concepts WHERE label = ?').get(body.label);
        return existing;
      }
      throw err;
    }
  });

  // POST /concepts/mention
  app.post('/concepts/mention', async (request) => {
    const body = request.body as {
      concept_id: string;
      entity_type: string;
      entity_id: string;
      confidence?: number;
    };

    const id = randomUUID().replace(/-/g, '');

    db.prepare(`
      INSERT INTO concept_mentions (id, concept_id, entity_type, entity_id, confidence)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, body.concept_id, body.entity_type, body.entity_id, body.confidence || 1.0);

    // Update mention count
    db.prepare(`
      UPDATE concepts
      SET mention_count = mention_count + 1,
          last_mentioned_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(body.concept_id);

    return { id };
  });

  // POST /concepts/:id/merge
  app.post('/concepts/:id/merge', async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { into_id: string };

    // Mark source concept as merged
    db.prepare(`
      UPDATE concepts
      SET merged_into_id = ?, active = 0, updated_at = datetime('now')
      WHERE id = ?
    `).run(body.into_id, id);

    // Update mentions to point to target
    db.prepare(`
      UPDATE concept_mentions SET concept_id = ? WHERE concept_id = ?
    `).run(body.into_id, id);

    // Update target mention count
    const mentionCount = db.prepare(`
      SELECT COUNT(*) as count FROM concept_mentions WHERE concept_id = ?
    `).get(body.into_id) as { count: number };

    db.prepare(`
      UPDATE concepts SET mention_count = ?, updated_at = datetime('now') WHERE id = ?
    `).run(mentionCount.count, body.into_id);

    return { success: true, merged_from: id, merged_into: body.into_id };
  });

  // POST /concepts/:id/unmerge (reversible)
  app.post('/concepts/:id/unmerge', async (request) => {
    const { id } = request.params as { id: string };

    const concept = db.prepare('SELECT merged_into_id FROM concepts WHERE id = ?').get(id) as { merged_into_id: string | null };

    if (!concept?.merged_into_id) {
      throw { statusCode: 400, message: 'Concept is not merged' };
    }

    db.prepare(`
      UPDATE concepts
      SET merged_into_id = NULL, active = 1, updated_at = datetime('now')
      WHERE id = ?
    `).run(id);

    return { success: true, unmerged: id };
  });

  // GET /concepts/:id/related
  app.get('/concepts/:id/related', async (request) => {
    const { id } = request.params as { id: string };

    const related = db.prepare(`
      SELECT c.*, nc.distance, nc.rank
      FROM nearest_concepts nc
      JOIN concepts c ON c.id = nc.neighbor_id
      WHERE nc.concept_id = ? AND c.active = 1
      ORDER BY nc.rank
      LIMIT 10
    `).all(id);

    return { related };
  });
}
