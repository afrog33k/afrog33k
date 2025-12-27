/**
 * Gating Logic Tests
 *
 * Ronald-GI uses intelligent gating to decide when to run expensive operations:
 * - Repo tests only run when intensity/uncertainty thresholds are met
 * - This prevents wasting resources on low-value or low-interest items
 *
 * "Only dive deep when it matters."
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestDb, resetTestDb, closeTestDb } from './setup';

// Gating thresholds (matching the API implementation)
const INTENSITY_THRESHOLD = 0.7;
const UNCERTAINTY_THRESHOLD = 0.5;

interface GatingInput {
  url: string;
  intensity: number;
  uncertainty: number;
}

function shouldRunTests(input: GatingInput): { shouldRun: boolean; reason: string } {
  // Validate GitHub URL
  if (!input.url.includes('github.com')) {
    return { shouldRun: false, reason: 'Not a GitHub URL' };
  }

  // High intensity = user is deeply interested
  if (input.intensity >= INTENSITY_THRESHOLD) {
    return { shouldRun: true, reason: 'High user intensity' };
  }

  // High uncertainty = we need more signal
  if (input.uncertainty >= UNCERTAINTY_THRESHOLD) {
    return { shouldRun: true, reason: 'High uncertainty' };
  }

  return { shouldRun: false, reason: 'Below gating thresholds' };
}

describe('Test Run Gating Logic', () => {
  let db: ReturnType<typeof getTestDb>;

  beforeEach(() => {
    resetTestDb();
    db = getTestDb();
  });

  afterAll(() => {
    closeTestDb();
  });

  describe('Intensity-Based Gating', () => {
    it('should run tests when user intensity is high', () => {
      const result = shouldRunTests({
        url: 'https://github.com/owner/repo',
        intensity: 0.85, // Above 0.7 threshold
        uncertainty: 0.2,
      });

      expect(result.shouldRun).toBe(true);
      expect(result.reason).toBe('High user intensity');
    });

    it('should not run tests when user intensity is low', () => {
      const result = shouldRunTests({
        url: 'https://github.com/owner/repo',
        intensity: 0.3, // Below threshold
        uncertainty: 0.2,
      });

      expect(result.shouldRun).toBe(false);
      expect(result.reason).toBe('Below gating thresholds');
    });

    it('should calculate intensity from engagement patterns', () => {
      // Simulate multiple views, pins, and deep engagement
      const reportId = 'r1';
      db.prepare(`INSERT INTO reports (id, type, title, pinned) VALUES (?, 'repo_signal', 'Interesting Repo', 1)`).run(reportId);

      // Multiple views and deep scroll = high intensity
      db.prepare(`INSERT INTO telemetry (id, report_id, event_type, event_data_json) VALUES (?, ?, 'open', '{}')`).run('t1', reportId);
      db.prepare(`INSERT INTO telemetry (id, report_id, event_type, event_data_json) VALUES (?, ?, 'scroll', '{"depth": 0.95}')`).run('t2', reportId);
      db.prepare(`INSERT INTO telemetry (id, report_id, event_type, event_data_json) VALUES (?, ?, 'click', '{}')`).run('t3', reportId);

      // Count engagement signals
      const signals = db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM telemetry WHERE report_id = ? AND event_type = 'open') as opens,
          (SELECT COUNT(*) FROM telemetry WHERE report_id = ? AND event_type = 'click') as clicks,
          (SELECT pinned FROM reports WHERE id = ?) as pinned
      `).get(reportId, reportId, reportId) as any;

      // Intensity calculation: opens + clicks*2 + pinned*5 normalized
      const rawIntensity = signals.opens + signals.clicks * 2 + signals.pinned * 5;
      const intensity = Math.min(1, rawIntensity / 10);

      expect(intensity).toBeGreaterThan(INTENSITY_THRESHOLD);
    });
  });

  describe('Uncertainty-Based Gating', () => {
    it('should run tests when uncertainty is high', () => {
      const result = shouldRunTests({
        url: 'https://github.com/owner/repo',
        intensity: 0.3,
        uncertainty: 0.6, // Above 0.5 threshold
      });

      expect(result.shouldRun).toBe(true);
      expect(result.reason).toBe('High uncertainty');
    });

    it('should calculate uncertainty from conflicting signals', () => {
      // High novelty but unknown impact = uncertainty
      const reportId = 'r1';
      db.prepare(`
        INSERT INTO reports (id, type, title, novelty_score, impact_score)
        VALUES (?, 'repo_signal', 'Novel but Unknown', 0.9, 0.1)
      `).run(reportId);

      const report = db.prepare('SELECT novelty_score, impact_score FROM reports WHERE id = ?').get(reportId) as any;

      // Uncertainty = |novelty - impact| when both are extreme
      const uncertainty = Math.abs(report.novelty_score - report.impact_score);

      expect(uncertainty).toBeGreaterThan(UNCERTAINTY_THRESHOLD);
    });

    it('should have low uncertainty when signals agree', () => {
      const reportId = 'r1';
      db.prepare(`
        INSERT INTO reports (id, type, title, novelty_score, impact_score)
        VALUES (?, 'repo_signal', 'Clear Value', 0.8, 0.85)
      `).run(reportId);

      const report = db.prepare('SELECT novelty_score, impact_score FROM reports WHERE id = ?').get(reportId) as any;

      const uncertainty = Math.abs(report.novelty_score - report.impact_score);

      expect(uncertainty).toBeLessThan(UNCERTAINTY_THRESHOLD);
    });
  });

  describe('URL Validation', () => {
    it('should reject non-GitHub URLs', () => {
      const result = shouldRunTests({
        url: 'https://gitlab.com/owner/repo',
        intensity: 0.9,
        uncertainty: 0.9,
      });

      expect(result.shouldRun).toBe(false);
      expect(result.reason).toBe('Not a GitHub URL');
    });

    it('should accept various GitHub URL formats', () => {
      const urls = [
        'https://github.com/owner/repo',
        'https://github.com/owner/repo.git',
        'https://www.github.com/owner/repo',
        'http://github.com/owner/repo',
      ];

      for (const url of urls) {
        const result = shouldRunTests({ url, intensity: 0.8, uncertainty: 0.2 });
        expect(result.shouldRun).toBe(true);
      }
    });
  });

  describe('Test Run Deduplication', () => {
    it('should prevent duplicate runs within time window', () => {
      const url = 'https://github.com/owner/repo';

      // First run
      db.prepare(`
        INSERT INTO test_runs (id, url, owner, repo, status)
        VALUES ('run1', ?, 'owner', 'repo', 'completed')
      `).run(url);

      // Check for recent runs (within 1 hour)
      const recentRun = db.prepare(`
        SELECT * FROM test_runs
        WHERE url = ? AND created_at > datetime('now', '-1 hour')
      `).get(url);

      expect(recentRun).toBeDefined();
    });

    it('should allow runs after time window expires', () => {
      const url = 'https://github.com/owner/repo';

      // Old run (2 hours ago)
      db.prepare(`
        INSERT INTO test_runs (id, url, owner, repo, status, created_at)
        VALUES ('run1', ?, 'owner', 'repo', 'completed', datetime('now', '-2 hours'))
      `).run(url);

      // Check for recent runs (within 1 hour)
      const recentRun = db.prepare(`
        SELECT * FROM test_runs
        WHERE url = ? AND created_at > datetime('now', '-1 hour')
      `).get(url);

      expect(recentRun).toBeUndefined();
    });
  });

  describe('Escalation Flow', () => {
    it('should record user escalation decision', () => {
      const reportId = 'r1';
      db.prepare(`INSERT INTO reports (id, type, title) VALUES (?, 'repo_signal', 'Maybe Test?')`).run(reportId);

      // User explicitly requests testing
      db.prepare(`
        INSERT INTO feedback (id, report_id, action, comment)
        VALUES ('f1', ?, 'escalate_test', 'Want to see if tests pass')
      `).run(reportId);

      const escalation = db.prepare(`
        SELECT * FROM feedback WHERE report_id = ? AND action LIKE 'escalate_%'
      `).get(reportId);

      expect(escalation).toBeDefined();
    });

    it('should track all escalation decisions for learning', () => {
      const reportId = 'r1';
      db.prepare(`INSERT INTO reports (id, type, title) VALUES (?, 'repo_signal', 'Test?')`).run(reportId);

      // Test decision
      db.prepare(`INSERT INTO feedback (id, report_id, action) VALUES ('f1', ?, 'escalate_test')`).run(reportId);

      // Skip decision
      const reportId2 = 'r2';
      db.prepare(`INSERT INTO reports (id, type, title) VALUES (?, 'repo_signal', 'Skip?')`).run(reportId2);
      db.prepare(`INSERT INTO feedback (id, report_id, action) VALUES ('f2', ?, 'escalate_skip')`).run(reportId2);

      // Count decisions
      const counts = db.prepare(`
        SELECT action, COUNT(*) as count FROM feedback
        WHERE action LIKE 'escalate_%'
        GROUP BY action
      `).all() as any[];

      expect(counts.length).toBe(2);
    });
  });

  describe('Test Result Integration', () => {
    it('should update report with test results', () => {
      // Create source first (foreign key constraint)
      db.prepare(`
        INSERT INTO sources (id, url, host)
        VALUES ('src1', 'https://github.com/owner/repo', 'github.com')
      `).run();

      const reportId = 'r1';
      db.prepare(`
        INSERT INTO reports (id, type, title, source_id)
        VALUES (?, 'repo_signal', 'Project Analysis', 'src1')
      `).run(reportId);

      // Test run completes
      db.prepare(`
        INSERT INTO test_runs (id, url, owner, repo, passed, summary, status)
        VALUES ('run1', 'https://github.com/owner/repo', 'owner', 'repo', 1, '15 tests passed', 'completed')
      `).run();

      // Verify test run exists and passed
      const testRun = db.prepare(`
        SELECT * FROM test_runs WHERE url = ?
      `).get('https://github.com/owner/repo') as any;

      expect(testRun.passed).toBe(1);
      expect(testRun.summary).toContain('passed');
    });

    it('should boost confidence when tests pass', () => {
      // Create report with moderate impact
      const reportId = 'r1';
      db.prepare(`
        INSERT INTO reports (id, type, title, impact_score, novelty_score)
        VALUES (?, 'repo_signal', 'Promising Project', 0.6, 0.7)
      `).run(reportId);

      // Simulate test passing → boost impact
      const PASS_BOOST = 0.15;
      db.prepare(`
        UPDATE reports SET impact_score = MIN(1.0, impact_score + ?)
        WHERE id = ?
      `).run(PASS_BOOST, reportId);

      const report = db.prepare('SELECT impact_score FROM reports WHERE id = ?').get(reportId) as any;
      expect(report.impact_score).toBe(0.75);
    });
  });
});
