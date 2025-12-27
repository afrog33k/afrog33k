import { z } from 'zod';
import { randomUUID } from 'crypto';
import { getDb } from '../lib/db.js';
const ReportType = z.enum([
    'decision_memo',
    'research_brief',
    'repo_signal',
    'concept_drift',
    'watchlist_alert'
]);
const CreateReportSchema = z.object({
    type: ReportType,
    title: z.string().min(1),
    summary: z.string().optional(),
    findings_json: z.string().optional(),
    decision: z.string().optional(),
    next_actions_json: z.string().optional(),
    evidence_json: z.string().optional(),
    ui_blocks_json: z.string().optional(),
    concept_ids_json: z.string().optional(),
    impact_score: z.number().optional(),
    novelty_score: z.number().optional(),
    relevance_score: z.number().optional(),
    promoted: z.number().optional(),
    source_cluster_id: z.string().optional(),
    source_id: z.string().optional(),
    cost_tokens: z.number().optional(),
    cost_dollars: z.number().optional(),
});
export async function reportRoutes(app) {
    const db = getDb();
    // GET /reports - List all reports with filters
    app.get('/reports', async (request) => {
        const query = request.query;
        const limit = parseInt(query.limit || '50');
        const offset = parseInt(query.offset || '0');
        const sort = query.sort || 'blended_score';
        const type = query.type;
        const promoted = query.promoted;
        const pinned = query.pinned;
        let sql = 'SELECT * FROM reports WHERE archived = 0';
        const params = [];
        if (type) {
            sql += ' AND type = ?';
            params.push(type);
        }
        if (promoted !== undefined) {
            sql += ' AND promoted = ?';
            params.push(parseInt(promoted));
        }
        if (pinned !== undefined) {
            sql += ' AND pinned = ?';
            params.push(parseInt(pinned));
        }
        const sortMap = {
            blended_score: 'blended_score DESC',
            newest: 'created_at DESC',
            impact: 'impact_score DESC',
            novelty: 'novelty_score DESC',
            relevance: 'relevance_score DESC',
        };
        sql += ` ORDER BY ${sortMap[sort] || sortMap.blended_score}`;
        sql += ' LIMIT ? OFFSET ?';
        params.push(limit, offset);
        const reports = db.prepare(sql).all(...params);
        const countSql = sql.replace(/SELECT \*/, 'SELECT COUNT(*) as count').replace(/ ORDER BY.*/, '');
        const total = db.prepare(countSql).get(...params.slice(0, -2)).count;
        return { reports, total, limit, offset };
    });
    // GET /reports/home - Get 3+1 stack for home view
    app.get('/reports/home', async () => {
        // Top 3: highest blended score (impact + novelty)
        const top3 = db.prepare(`
      SELECT * FROM reports
      WHERE archived = 0 AND promoted = 1
      ORDER BY blended_score DESC
      LIMIT 3
    `).all();
        // +1: best relevance pick (current obsession)
        const relevancePick = db.prepare(`
      SELECT * FROM reports
      WHERE archived = 0 AND promoted = 1
      AND id NOT IN (SELECT id FROM reports WHERE archived = 0 AND promoted = 1 ORDER BY blended_score DESC LIMIT 3)
      ORDER BY relevance_score DESC
      LIMIT 1
    `).get();
        return {
            top3,
            relevancePick: relevancePick || null,
        };
    });
    // GET /reports/:id
    app.get('/reports/:id', async (request) => {
        const { id } = request.params;
        const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(id);
        if (!report) {
            throw { statusCode: 404, message: 'Report not found' };
        }
        return report;
    });
    // POST /reports
    app.post('/reports', async (request) => {
        const body = CreateReportSchema.parse(request.body);
        const id = randomUUID().replace(/-/g, '');
        const stmt = db.prepare(`
      INSERT INTO reports (
        id, type, title, summary, findings_json, decision, next_actions_json,
        evidence_json, ui_blocks_json, concept_ids_json, impact_score, novelty_score,
        relevance_score, promoted, source_cluster_id, source_id, cost_tokens, cost_dollars
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        stmt.run(id, body.type, body.title, body.summary || null, body.findings_json || '[]', body.decision || null, body.next_actions_json || '[]', body.evidence_json || '[]', body.ui_blocks_json || '[]', body.concept_ids_json || '[]', body.impact_score || 0, body.novelty_score || 0, body.relevance_score || 0, body.promoted || 0, body.source_cluster_id || null, body.source_id || null, body.cost_tokens || 0, body.cost_dollars || 0);
        return { id, ...body };
    });
    // PATCH /reports/:id
    app.patch('/reports/:id', async (request) => {
        const { id } = request.params;
        const body = request.body;
        const allowedFields = [
            'title', 'summary', 'findings_json', 'decision', 'next_actions_json',
            'evidence_json', 'ui_blocks_json', 'concept_ids_json', 'impact_score',
            'novelty_score', 'relevance_score', 'pinned', 'promoted', 'archived'
        ];
        const updates = [];
        const values = [];
        for (const [key, value] of Object.entries(body)) {
            if (allowedFields.includes(key)) {
                updates.push(`${key} = ?`);
                values.push(value);
            }
        }
        if (updates.length === 0) {
            throw { statusCode: 400, message: 'No valid fields to update' };
        }
        updates.push('updated_at = datetime("now")');
        values.push(id);
        db.prepare(`UPDATE reports SET ${updates.join(', ')} WHERE id = ?`).run(...values);
        return db.prepare('SELECT * FROM reports WHERE id = ?').get(id);
    });
    // POST /reports/:id/pin
    app.post('/reports/:id/pin', async (request) => {
        const { id } = request.params;
        db.prepare('UPDATE reports SET pinned = 1, updated_at = datetime("now") WHERE id = ?').run(id);
        return { success: true };
    });
    // POST /reports/:id/unpin
    app.post('/reports/:id/unpin', async (request) => {
        const { id } = request.params;
        db.prepare('UPDATE reports SET pinned = 0, updated_at = datetime("now") WHERE id = ?').run(id);
        return { success: true };
    });
}
