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

  // ============================================
  // PHASE 6: CONCEPT DRIFT
  // ============================================

  // GET /concepts/similar - Find similar concepts above threshold
  app.get('/concepts/similar', async (request) => {
    const query = request.query as Record<string, string>;
    const threshold = parseFloat(query.threshold || '0.85');
    const limit = parseInt(query.limit || '20');

    // Get pairs with high similarity (low distance = high similarity)
    const similarPairs = db.prepare(`
      SELECT
        nc.concept_id,
        nc.neighbor_id,
        nc.distance,
        c1.label as concept_label,
        c2.label as neighbor_label,
        c1.mention_count as concept_mentions,
        c2.mention_count as neighbor_mentions
      FROM nearest_concepts nc
      JOIN concepts c1 ON c1.id = nc.concept_id AND c1.active = 1
      JOIN concepts c2 ON c2.id = nc.neighbor_id AND c2.active = 1
      WHERE nc.distance < ? AND nc.rank = 1
      ORDER BY nc.distance ASC
      LIMIT ?
    `).all(1 - threshold, limit);

    return {
      pairs: similarPairs,
      threshold,
      count: similarPairs.length
    };
  });

  // GET /concepts/merge-suggestions - Get pending merge suggestions
  app.get('/concepts/merge-suggestions', async (request) => {
    const query = request.query as Record<string, string>;
    const status = query.status || 'pending';

    const suggestions = db.prepare(`
      SELECT
        ms.*,
        c1.label as concept_a_label,
        c2.label as concept_b_label,
        c1.mention_count as concept_a_mentions,
        c2.mention_count as concept_b_mentions
      FROM merge_suggestions ms
      JOIN concepts c1 ON c1.id = ms.concept_a_id
      JOIN concepts c2 ON c2.id = ms.concept_b_id
      WHERE ms.status = ?
      ORDER BY ms.similarity DESC
    `).all(status);

    return { suggestions };
  });

  // POST /concepts/generate-merge-suggestions - Auto-detect similar concepts
  app.post('/concepts/generate-merge-suggestions', async () => {
    const SIMILARITY_THRESHOLD = 0.85;

    // Find highly similar active concepts
    const candidates = db.prepare(`
      SELECT
        nc.concept_id,
        nc.neighbor_id,
        nc.distance,
        c1.label as label_a,
        c2.label as label_b
      FROM nearest_concepts nc
      JOIN concepts c1 ON c1.id = nc.concept_id AND c1.active = 1
      JOIN concepts c2 ON c2.id = nc.neighbor_id AND c2.active = 1
      WHERE nc.distance < ? AND nc.rank = 1
      AND NOT EXISTS (
        SELECT 1 FROM merge_suggestions ms
        WHERE (ms.concept_a_id = nc.concept_id AND ms.concept_b_id = nc.neighbor_id)
           OR (ms.concept_a_id = nc.neighbor_id AND ms.concept_b_id = nc.concept_id)
      )
    `).all(1 - SIMILARITY_THRESHOLD);

    let created = 0;
    for (const c of candidates) {
      const id = randomUUID().replace(/-/g, '');
      const similarity = 1 - (c as any).distance;

      try {
        db.prepare(`
          INSERT INTO merge_suggestions (id, concept_a_id, concept_b_id, similarity, reason)
          VALUES (?, ?, ?, ?, ?)
        `).run(id, (c as any).concept_id, (c as any).neighbor_id, similarity,
          `High similarity (${(similarity * 100).toFixed(1)}%) between "${(c as any).label_a}" and "${(c as any).label_b}"`);
        created++;
      } catch (err) {
        // Ignore duplicates
      }
    }

    return { created, total_candidates: candidates.length };
  });

  // POST /concepts/merge-suggestions/:id/accept - Accept a merge suggestion
  app.post('/concepts/merge-suggestions/:id/accept', async (request) => {
    const { id } = request.params as { id: string };

    const suggestion = db.prepare(`
      SELECT * FROM merge_suggestions WHERE id = ?
    `).get(id) as any;

    if (!suggestion) {
      throw { statusCode: 404, message: 'Suggestion not found' };
    }

    // Get concept info for logging
    const conceptA = db.prepare('SELECT * FROM concepts WHERE id = ?').get(suggestion.concept_a_id) as any;
    const conceptB = db.prepare('SELECT * FROM concepts WHERE id = ?').get(suggestion.concept_b_id) as any;

    // Merge A into B (keep the one with more mentions)
    const [source, target] = conceptA.mention_count < conceptB.mention_count
      ? [conceptA, conceptB]
      : [conceptB, conceptA];

    // Log the change
    db.prepare(`
      INSERT INTO concept_changes (id, concept_id, change_type, old_state_json, new_state_json, related_concept_id, reason)
      VALUES (?, ?, 'merged', ?, ?, ?, ?)
    `).run(
      randomUUID().replace(/-/g, ''),
      source.id,
      JSON.stringify(source),
      JSON.stringify({ ...source, active: 0, merged_into_id: target.id }),
      target.id,
      `Merge suggestion accepted: ${source.label} → ${target.label}`
    );

    // Perform the merge
    db.prepare(`
      UPDATE concepts SET merged_into_id = ?, active = 0, updated_at = datetime('now')
      WHERE id = ?
    `).run(target.id, source.id);

    db.prepare(`
      UPDATE concept_mentions SET concept_id = ? WHERE concept_id = ?
    `).run(target.id, source.id);

    // Update suggestion status
    db.prepare(`
      UPDATE merge_suggestions SET status = 'accepted', reviewed_at = datetime('now')
      WHERE id = ?
    `).run(id);

    return { success: true, merged_from: source.id, merged_into: target.id };
  });

  // POST /concepts/merge-suggestions/:id/reject - Reject a merge suggestion
  app.post('/concepts/merge-suggestions/:id/reject', async (request) => {
    const { id } = request.params as { id: string };

    db.prepare(`
      UPDATE merge_suggestions SET status = 'rejected', reviewed_at = datetime('now')
      WHERE id = ?
    `).run(id);

    return { success: true };
  });

  // GET /concepts/kill-suggestions - Get pending kill suggestions
  app.get('/concepts/kill-suggestions', async (request) => {
    const query = request.query as Record<string, string>;
    const status = query.status || 'pending';

    const suggestions = db.prepare(`
      SELECT
        ks.*,
        c.label,
        c.mention_count,
        c.last_mentioned_at
      FROM kill_suggestions ks
      JOIN concepts c ON c.id = ks.concept_id
      WHERE ks.status = ?
      ORDER BY ks.confidence DESC
    `).all(status);

    return { suggestions };
  });

  // POST /concepts/generate-kill-suggestions - Auto-detect low-value concepts
  app.post('/concepts/generate-kill-suggestions', async () => {
    let created = 0;

    // Find orphan concepts (no mentions)
    const orphans = db.prepare(`
      SELECT c.id, c.label
      FROM concepts c
      WHERE c.active = 1 AND c.mention_count = 0
      AND NOT EXISTS (SELECT 1 FROM kill_suggestions ks WHERE ks.concept_id = c.id AND ks.status = 'pending')
    `).all();

    for (const c of orphans) {
      const id = randomUUID().replace(/-/g, '');
      try {
        db.prepare(`
          INSERT INTO kill_suggestions (id, concept_id, reason, confidence)
          VALUES (?, ?, 'orphan', 0.7)
        `).run(id, (c as any).id);
        created++;
      } catch (err) { /* ignore */ }
    }

    // Find stale concepts (not mentioned in 30+ days)
    const stale = db.prepare(`
      SELECT c.id, c.label
      FROM concepts c
      WHERE c.active = 1
      AND c.last_mentioned_at < datetime('now', '-30 days')
      AND c.mention_count < 3
      AND NOT EXISTS (SELECT 1 FROM kill_suggestions ks WHERE ks.concept_id = c.id AND ks.status = 'pending')
    `).all();

    for (const c of stale) {
      const id = randomUUID().replace(/-/g, '');
      try {
        db.prepare(`
          INSERT INTO kill_suggestions (id, concept_id, reason, confidence)
          VALUES (?, ?, 'stale', 0.5)
        `).run(id, (c as any).id);
        created++;
      } catch (err) { /* ignore */ }
    }

    return { created, orphans_found: orphans.length, stale_found: stale.length };
  });

  // POST /concepts/:id/kill - Soft delete a concept
  app.post('/concepts/:id/kill', async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { reason?: string };

    const concept = db.prepare('SELECT * FROM concepts WHERE id = ?').get(id) as any;
    if (!concept) {
      throw { statusCode: 404, message: 'Concept not found' };
    }

    // Log the change
    db.prepare(`
      INSERT INTO concept_changes (id, concept_id, change_type, old_state_json, new_state_json, reason)
      VALUES (?, ?, 'killed', ?, ?, ?)
    `).run(
      randomUUID().replace(/-/g, ''),
      id,
      JSON.stringify(concept),
      JSON.stringify({ ...concept, active: 0 }),
      body.reason || 'Manual kill'
    );

    // Soft delete
    db.prepare(`
      UPDATE concepts SET active = 0, updated_at = datetime('now')
      WHERE id = ?
    `).run(id);

    // Update any pending kill suggestions
    db.prepare(`
      UPDATE kill_suggestions SET status = 'accepted', reviewed_at = datetime('now')
      WHERE concept_id = ? AND status = 'pending'
    `).run(id);

    return { success: true, killed: id };
  });

  // POST /concepts/:id/revive - Undo a kill
  app.post('/concepts/:id/revive', async (request) => {
    const { id } = request.params as { id: string };

    const concept = db.prepare('SELECT * FROM concepts WHERE id = ?').get(id) as any;
    if (!concept) {
      throw { statusCode: 404, message: 'Concept not found' };
    }

    if (concept.active === 1) {
      throw { statusCode: 400, message: 'Concept is already active' };
    }

    // Log the change
    db.prepare(`
      INSERT INTO concept_changes (id, concept_id, change_type, old_state_json, new_state_json, reason)
      VALUES (?, ?, 'revived', ?, ?, ?)
    `).run(
      randomUUID().replace(/-/g, ''),
      id,
      JSON.stringify(concept),
      JSON.stringify({ ...concept, active: 1 }),
      'Manual revive'
    );

    // Revive
    db.prepare(`
      UPDATE concepts SET active = 1, merged_into_id = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(id);

    return { success: true, revived: id };
  });

  // GET /concepts/changes - Weekly diff view
  app.get('/concepts/changes', async (request) => {
    const query = request.query as Record<string, string>;
    const days = parseInt(query.days || '7');
    const changeType = query.type;

    let sql = `
      SELECT
        cc.*,
        c.label,
        rc.label as related_label
      FROM concept_changes cc
      JOIN concepts c ON c.id = cc.concept_id
      LEFT JOIN concepts rc ON rc.id = cc.related_concept_id
      WHERE cc.created_at >= datetime('now', '-' || ? || ' days')
    `;
    const params: any[] = [days];

    if (changeType) {
      sql += ' AND cc.change_type = ?';
      params.push(changeType);
    }

    sql += ' ORDER BY cc.created_at DESC';

    const changes = db.prepare(sql).all(...params);

    // Summary stats
    const summary = db.prepare(`
      SELECT
        change_type,
        COUNT(*) as count
      FROM concept_changes
      WHERE created_at >= datetime('now', '-' || ? || ' days')
      GROUP BY change_type
    `).all(days);

    return {
      changes,
      summary,
      period_days: days
    };
  });

  // GET /concepts/drift-report - Weekly concept drift summary
  app.get('/concepts/drift-report', async () => {
    const weekAgo = "datetime('now', '-7 days')";

    const report = {
      // New concepts this week
      new_concepts: db.prepare(`
        SELECT COUNT(*) as count FROM concepts
        WHERE created_at >= ${weekAgo}
      `).get() as { count: number },

      // Merged concepts this week
      merged_concepts: db.prepare(`
        SELECT COUNT(*) as count FROM concept_changes
        WHERE change_type = 'merged' AND created_at >= ${weekAgo}
      `).get() as { count: number },

      // Killed concepts this week
      killed_concepts: db.prepare(`
        SELECT COUNT(*) as count FROM concept_changes
        WHERE change_type = 'killed' AND created_at >= ${weekAgo}
      `).get() as { count: number },

      // Most active concepts (by mention growth)
      trending_up: db.prepare(`
        SELECT c.id, c.label, c.mention_count,
               COUNT(cm.id) as recent_mentions
        FROM concepts c
        LEFT JOIN concept_mentions cm ON cm.concept_id = c.id
          AND cm.created_at >= ${weekAgo}
        WHERE c.active = 1
        GROUP BY c.id
        HAVING recent_mentions > 0
        ORDER BY recent_mentions DESC
        LIMIT 5
      `).all(),

      // Pending suggestions
      pending_merges: (db.prepare(`
        SELECT COUNT(*) as count FROM merge_suggestions WHERE status = 'pending'
      `).get() as { count: number }).count,

      pending_kills: (db.prepare(`
        SELECT COUNT(*) as count FROM kill_suggestions WHERE status = 'pending'
      `).get() as { count: number }).count,

      // Total active concepts
      total_active: (db.prepare(`
        SELECT COUNT(*) as count FROM concepts WHERE active = 1
      `).get() as { count: number }).count,
    };

    return report;
  });
}
