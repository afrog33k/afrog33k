import { z } from 'zod';
import { randomUUID } from 'crypto';
import { getDb } from '../lib/db.js';
const CreateSourceSchema = z.object({
    url: z.string().url(),
    title: z.string().optional(),
    description: z.string().optional(),
    tags_json: z.string().optional(),
    priority: z.number().optional(),
});
export async function sourceRoutes(app) {
    const db = getDb();
    // GET /sources
    app.get('/sources', async (request) => {
        const query = request.query;
        const limit = parseInt(query.limit || '50');
        const offset = parseInt(query.offset || '0');
        const processed = query.processed;
        let sql = 'SELECT * FROM sources';
        const params = [];
        if (processed === 'true') {
            sql += ' WHERE processed_at IS NOT NULL';
        }
        else if (processed === 'false') {
            sql += ' WHERE processed_at IS NULL';
        }
        sql += ' ORDER BY priority DESC, created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);
        const sources = db.prepare(sql).all(...params);
        return { sources };
    });
    // POST /sources
    app.post('/sources', async (request) => {
        const body = CreateSourceSchema.parse(request.body);
        const id = randomUUID().replace(/-/g, '');
        const host = new URL(body.url).hostname;
        try {
            const stmt = db.prepare(`
        INSERT INTO sources (id, url, title, description, host, tags_json, priority)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
            stmt.run(id, body.url, body.title || null, body.description || null, host, body.tags_json || '[]', body.priority || 0);
            return { id, url: body.url, host };
        }
        catch (err) {
            if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                throw { statusCode: 409, message: 'Source URL already exists' };
            }
            throw err;
        }
    });
    // POST /sources/batch
    app.post('/sources/batch', async (request) => {
        const body = request.body;
        const results = { added: 0, skipped: 0, errors: [] };
        const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO sources (id, url, title, description, host, tags_json, priority)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
        const insertMany = db.transaction((sources) => {
            for (const source of sources) {
                try {
                    const parsed = CreateSourceSchema.parse(source);
                    const id = randomUUID().replace(/-/g, '');
                    const host = new URL(parsed.url).hostname;
                    const result = insertStmt.run(id, parsed.url, parsed.title || null, parsed.description || null, host, parsed.tags_json || '[]', parsed.priority || 0);
                    if (result.changes > 0) {
                        results.added++;
                    }
                    else {
                        results.skipped++;
                    }
                }
                catch (err) {
                    results.errors.push(`${source.url}: ${err.message}`);
                }
            }
        });
        insertMany(body.sources);
        return results;
    });
    // PATCH /sources/:id/mark-processed
    app.patch('/sources/:id/mark-processed', async (request) => {
        const { id } = request.params;
        db.prepare('UPDATE sources SET processed_at = datetime("now"), updated_at = datetime("now") WHERE id = ?').run(id);
        return { success: true };
    });
}
