import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { getDb } from '../lib/db.js';
import { spawn } from 'child_process';
import { join } from 'path';

const TriggerTestSchema = z.object({
  url: z.string().url(),
  intensity: z.number().optional().default(0),
  uncertainty: z.number().optional().default(0),
  force: z.boolean().optional().default(false),
});

const EscalateSchema = z.object({
  report_id: z.string(),
  action: z.enum(['test', 'skip', 'defer']),
  reason: z.string().optional(),
});

// Gating thresholds
const INTENSITY_THRESHOLD = 0.7;
const UNCERTAINTY_THRESHOLD = 0.5;

export async function testRoutes(app: FastifyInstance) {
  const db = getDb();

  // Ensure test_runs table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS test_runs (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      project_type TEXT,
      passed INTEGER DEFAULT 0,
      summary TEXT,
      clone_result_json TEXT,
      install_result_json TEXT,
      test_result_json TEXT,
      total_duration_ms INTEGER,
      triggered_by TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_test_runs_url ON test_runs(url)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_test_runs_status ON test_runs(status)`);

  // GET /tests - List test runs
  app.get('/tests', async (request) => {
    const query = request.query as Record<string, string>;
    const limit = parseInt(query.limit || '20');
    const status = query.status;

    let sql = 'SELECT * FROM test_runs';
    const params: any[] = [];

    if (status) {
      sql += ' WHERE status = ?';
      params.push(status);
    }

    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const runs = db.prepare(sql).all(...params);
    return { runs };
  });

  // GET /tests/:id - Get single test run
  app.get('/tests/:id', async (request) => {
    const { id } = request.params as { id: string };

    const run = db.prepare('SELECT * FROM test_runs WHERE id = ?').get(id) as any;
    if (!run) {
      throw { statusCode: 404, message: 'Test run not found' };
    }

    // Parse JSON fields
    if (run.clone_result_json) run.clone_result = JSON.parse(run.clone_result_json);
    if (run.install_result_json) run.install_result = JSON.parse(run.install_result_json);
    if (run.test_result_json) run.test_result = JSON.parse(run.test_result_json);

    return run;
  });

  // POST /tests/trigger - Trigger a test run
  app.post('/tests/trigger', async (request) => {
    const body = TriggerTestSchema.parse(request.body);

    // Parse GitHub URL
    const match = body.url.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) {
      throw { statusCode: 400, message: 'Invalid GitHub URL' };
    }

    const [, owner, repo] = match;
    const repoName = repo.replace(/\.git$/, '');

    // Check gating thresholds
    const shouldRun = body.force ||
      body.intensity >= INTENSITY_THRESHOLD ||
      body.uncertainty >= UNCERTAINTY_THRESHOLD;

    if (!shouldRun) {
      return {
        triggered: false,
        reason: 'Below gating thresholds',
        thresholds: {
          intensity: { current: body.intensity, required: INTENSITY_THRESHOLD },
          uncertainty: { current: body.uncertainty, required: UNCERTAINTY_THRESHOLD },
        },
        suggestion: 'Use force=true to override gating'
      };
    }

    // Check for recent runs (within 1 hour)
    const recentRun = db.prepare(`
      SELECT * FROM test_runs
      WHERE url = ? AND created_at > datetime('now', '-1 hour')
      ORDER BY created_at DESC LIMIT 1
    `).get(body.url) as any;

    if (recentRun && !body.force) {
      return {
        triggered: false,
        reason: 'Recent test run exists',
        existing_run_id: recentRun.id,
        existing_status: recentRun.status,
        existing_passed: recentRun.passed === 1,
      };
    }

    // Create test run record
    const runId = randomUUID().replace(/-/g, '');
    db.prepare(`
      INSERT INTO test_runs (id, url, owner, repo, status, triggered_by)
      VALUES (?, ?, ?, ?, 'pending', 'api')
    `).run(runId, body.url, owner, repoName);

    // Spawn the test runner in background
    const scriptsPath = process.env.SCRIPTS_PATH || '/app/scripts';
    const runnerPath = join(scriptsPath, 'repo_runner.py');

    const child = spawn('python3', [runnerPath, body.url], {
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        DATABASE_PATH: process.env.DATABASE_PATH || '/app/data/ronald.db',
      }
    });

    child.unref();

    // Update status to running
    db.prepare(`
      UPDATE test_runs SET status = 'running' WHERE id = ?
    `).run(runId);

    return {
      triggered: true,
      run_id: runId,
      url: body.url,
      owner,
      repo: repoName,
      message: 'Test run started in background'
    };
  });

  // POST /tests/escalate - User decision on whether to test
  app.post('/tests/escalate', async (request) => {
    const body = EscalateSchema.parse(request.body);

    const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(body.report_id) as any;
    if (!report) {
      throw { statusCode: 404, message: 'Report not found' };
    }

    // Find associated source URL
    let sourceUrl: string | null = null;
    if (report.source_id) {
      const source = db.prepare('SELECT url FROM sources WHERE id = ?').get(report.source_id) as any;
      sourceUrl = source?.url;
    }

    // Log the decision
    const decisionId = randomUUID().replace(/-/g, '');
    db.prepare(`
      INSERT INTO feedback (id, report_id, action, comment)
      VALUES (?, ?, ?, ?)
    `).run(decisionId, body.report_id, `escalate_${body.action}`, body.reason || null);

    if (body.action === 'test' && sourceUrl) {
      // Trigger test run
      const match = sourceUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
      if (match) {
        const [, owner, repo] = match;
        const repoName = repo.replace(/\.git$/, '');
        const runId = randomUUID().replace(/-/g, '');

        db.prepare(`
          INSERT INTO test_runs (id, url, owner, repo, status, triggered_by)
          VALUES (?, ?, ?, ?, 'pending', 'escalate')
        `).run(runId, sourceUrl, owner, repoName);

        // Spawn test runner
        const scriptsPath = process.env.SCRIPTS_PATH || '/app/scripts';
        const runnerPath = join(scriptsPath, 'repo_runner.py');

        const child = spawn('python3', [runnerPath, sourceUrl], {
          detached: true,
          stdio: 'ignore',
          env: {
            ...process.env,
            DATABASE_PATH: process.env.DATABASE_PATH || '/app/data/ronald.db',
          }
        });
        child.unref();

        db.prepare(`UPDATE test_runs SET status = 'running' WHERE id = ?`).run(runId);

        return {
          action: 'test',
          run_id: runId,
          url: sourceUrl,
          message: 'Test run triggered'
        };
      }
    }

    return {
      action: body.action,
      recorded: true,
      report_id: body.report_id
    };
  });

  // GET /tests/should-run - Check if tests should run for a URL
  app.get('/tests/should-run', async (request) => {
    const query = request.query as Record<string, string>;
    const url = query.url;
    const intensity = parseFloat(query.intensity || '0');
    const uncertainty = parseFloat(query.uncertainty || '0');

    if (!url) {
      throw { statusCode: 400, message: 'url parameter required' };
    }

    const shouldRun = intensity >= INTENSITY_THRESHOLD ||
                      uncertainty >= UNCERTAINTY_THRESHOLD;

    // Check for recent runs
    const recentRun = db.prepare(`
      SELECT id, status, passed, summary, created_at
      FROM test_runs
      WHERE url = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(url) as any;

    return {
      should_run: shouldRun,
      reason: shouldRun
        ? (intensity >= INTENSITY_THRESHOLD ? 'High user intensity' : 'High uncertainty')
        : 'Below gating thresholds',
      thresholds: {
        intensity: { current: intensity, required: INTENSITY_THRESHOLD },
        uncertainty: { current: uncertainty, required: UNCERTAINTY_THRESHOLD },
      },
      recent_run: recentRun || null
    };
  });

  // GET /tests/stats - Test run statistics
  app.get('/tests/stats', async () => {
    const stats = {
      total: (db.prepare('SELECT COUNT(*) as count FROM test_runs').get() as any).count,
      passed: (db.prepare('SELECT COUNT(*) as count FROM test_runs WHERE passed = 1').get() as any).count,
      failed: (db.prepare("SELECT COUNT(*) as count FROM test_runs WHERE passed = 0 AND status = 'completed'").get() as any).count,
      pending: (db.prepare("SELECT COUNT(*) as count FROM test_runs WHERE status = 'pending'").get() as any).count,
      running: (db.prepare("SELECT COUNT(*) as count FROM test_runs WHERE status = 'running'").get() as any).count,
      avg_duration_ms: (db.prepare('SELECT AVG(total_duration_ms) as avg FROM test_runs WHERE total_duration_ms > 0').get() as any).avg || 0,

      by_project_type: db.prepare(`
        SELECT project_type, COUNT(*) as count, SUM(passed) as passed_count
        FROM test_runs
        WHERE project_type IS NOT NULL
        GROUP BY project_type
      `).all(),

      recent: db.prepare(`
        SELECT id, owner, repo, passed, summary, total_duration_ms, created_at
        FROM test_runs
        ORDER BY created_at DESC
        LIMIT 5
      `).all()
    };

    return stats;
  });
}
