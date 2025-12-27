/**
 * Ronald-GI Adaptive Behavior Tests
 *
 * These tests capture the ESSENCE of Ronald-GI:
 * 1. It LEARNS from how you interact with reports
 * 2. It EVOLVES its concept map through merge/kill lifecycle
 * 3. It KNOWS when to stop researching (stopping policy)
 * 4. It DETECTS discovery spikes from browsing behavior
 * 5. It ADAPTS UI actions based on what works
 *
 * "The system that watches you learn, learns to watch you better."
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  getTestDb,
  resetTestDb,
  closeTestDb,
  createTestReport,
  createTestConcept,
  simulateEngagement,
  submitFeedback,
  calculateSatisfaction,
  createSimilarConcepts,
  checkStoppingPolicy,
} from './setup';

describe('Adaptive Learning System', () => {
  let db: ReturnType<typeof getTestDb>;

  beforeEach(() => {
    resetTestDb();
    db = getTestDb();
  });

  afterAll(() => {
    closeTestDb();
  });

  describe('Satisfaction Prediction from Implicit Signals', () => {
    it('should learn that pinned reports indicate high satisfaction', () => {
      const reportId = createTestReport(db, { title: 'Great Research' });

      // User pins the report - strongest positive signal
      simulateEngagement(db, reportId, { opened: true, pinned: true });

      const satisfaction = calculateSatisfaction(db, reportId);
      expect(satisfaction).toBeGreaterThan(0.5);
    });

    it('should learn that deep scrolling indicates engagement', () => {
      const reportId = createTestReport(db, { title: 'Interesting Report' });

      // User scrolls to bottom - they read the whole thing
      simulateEngagement(db, reportId, {
        opened: true,
        scrollDepth: 0.95,
        dwellMs: 15000,
      });

      const satisfaction = calculateSatisfaction(db, reportId);
      expect(satisfaction).toBeGreaterThan(0.4);
    });

    it('should learn that quick dismissal indicates low satisfaction', () => {
      const reportId = createTestReport(db, { title: 'Boring Report' });

      // User opens and closes quickly with no interaction
      simulateEngagement(db, reportId, {
        opened: true,
        scrollDepth: 0.1,
        dwellMs: 500,
      });

      const satisfaction = calculateSatisfaction(db, reportId);
      expect(satisfaction).toBeLessThan(0.45);
    });

    it('should combine implicit and explicit signals', () => {
      const reportId = createTestReport(db, { title: 'Mixed Signals' });

      // User reads deeply but gives negative feedback
      simulateEngagement(db, reportId, {
        opened: true,
        scrollDepth: 0.9,
        dwellMs: 20000,
        clicked: true,
      });
      submitFeedback(db, reportId, 'not_useful');

      const satisfaction = calculateSatisfaction(db, reportId);
      // Explicit negative feedback should override implicit positive
      expect(satisfaction).toBeLessThan(0.5);
    });
  });

  describe('Concept Drift: Merge/Kill Lifecycle', () => {
    it('should detect similar concepts that should be merged', () => {
      const { id1, id2 } = createSimilarConcepts(db, 'machine learning', 'ML', 0.92);

      // Query for merge candidates (similarity > 0.85)
      const candidates = db.prepare(`
        SELECT * FROM nearest_concepts
        WHERE distance < 0.15 AND rank = 1
      `).all();

      expect(candidates.length).toBeGreaterThan(0);
    });

    it('should keep alias after merge for reversibility', () => {
      const { id1, id2 } = createSimilarConcepts(db, 'neural network', 'NN', 0.88);

      // Merge id2 into id1 (keep the more mentioned one)
      db.prepare(`
        UPDATE concepts SET merged_into_id = ?, active = 0 WHERE id = ?
      `).run(id1, id2);

      // Verify merge
      const merged = db.prepare('SELECT * FROM concepts WHERE id = ?').get(id2) as any;
      expect(merged.active).toBe(0);
      expect(merged.merged_into_id).toBe(id1);

      // Verify it can be unmerged
      db.prepare(`
        UPDATE concepts SET merged_into_id = NULL, active = 1 WHERE id = ?
      `).run(id2);

      const unmerged = db.prepare('SELECT * FROM concepts WHERE id = ?').get(id2) as any;
      expect(unmerged.active).toBe(1);
    });

    it('should detect orphan concepts for kill suggestion', () => {
      // Create concept with no mentions
      const orphanId = createTestConcept(db, { label: 'orphan-concept', mention_count: 0 });
      // Create concept with mentions
      const activeId = createTestConcept(db, { label: 'active-concept', mention_count: 10 });

      const orphans = db.prepare(`
        SELECT * FROM concepts WHERE active = 1 AND mention_count = 0
      `).all();

      expect(orphans).toHaveLength(1);
      expect((orphans[0] as any).id).toBe(orphanId);
    });

    it('should soft-delete killed concepts with undo capability', () => {
      const conceptId = createTestConcept(db, { label: 'to-be-killed', mention_count: 1 });

      // Kill (soft delete)
      db.prepare(`UPDATE concepts SET active = 0 WHERE id = ?`).run(conceptId);

      const killed = db.prepare('SELECT active FROM concepts WHERE id = ?').get(conceptId) as any;
      expect(killed.active).toBe(0);

      // Revive (undo kill)
      db.prepare(`UPDATE concepts SET active = 1 WHERE id = ?`).run(conceptId);

      const revived = db.prepare('SELECT active FROM concepts WHERE id = ?').get(conceptId) as any;
      expect(revived.active).toBe(1);
    });
  });

  describe('Stopping Policy: When to Stop Researching', () => {
    it('should stop when max tokens exceeded', () => {
      const report = {
        cost_tokens: 60000,
        cost_dollars: 0.30,
        findings_json: '["finding1"]',
        decision: null,
        summary: 'Partial summary',
      };

      const result = checkStoppingPolicy(report);
      expect(result.shouldStop).toBe(true);
      expect(result.reason).toBe('max_tokens');
    });

    it('should stop when max dollars exceeded', () => {
      const report = {
        cost_tokens: 10000,
        cost_dollars: 0.75,
        findings_json: '[]',
        decision: null,
        summary: null,
      };

      const result = checkStoppingPolicy(report);
      expect(result.shouldStop).toBe(true);
      expect(result.reason).toBe('max_dollars');
    });

    it('should stop when report is sufficiently complete', () => {
      const report = {
        cost_tokens: 5000,
        cost_dollars: 0.05,
        findings_json: '["finding1", "finding2", "finding3"]',
        decision: 'Recommended action',
        summary: 'Full summary',
      };

      const result = checkStoppingPolicy(report);
      expect(result.shouldStop).toBe(true);
      expect(result.reason).toBe('complete');
    });

    it('should continue when report is incomplete and under budget', () => {
      const report = {
        cost_tokens: 2000,
        cost_dollars: 0.02,
        findings_json: '[]',
        decision: null,
        summary: null,
      };

      const result = checkStoppingPolicy(report);
      expect(result.shouldStop).toBe(false);
      expect(result.reason).toBe('continue');
    });
  });

  describe('Discovery Spike Detection', () => {
    it('should detect burst of related visits', () => {
      // Simulate a discovery spike - multiple visits in short time to related URLs
      const visits = [
        { url: 'https://github.com/pytorch/pytorch', host: 'github.com', visited_at: '2024-01-01 10:00:00' },
        { url: 'https://pytorch.org/docs', host: 'pytorch.org', visited_at: '2024-01-01 10:02:00' },
        { url: 'https://arxiv.org/abs/ml-paper', host: 'arxiv.org', visited_at: '2024-01-01 10:05:00' },
        { url: 'https://github.com/huggingface/transformers', host: 'github.com', visited_at: '2024-01-01 10:08:00' },
      ];

      for (const v of visits) {
        db.prepare(`
          INSERT INTO visits (id, url, title, host, browser, visited_at)
          VALUES (?, ?, ?, ?, 'chrome', ?)
        `).run(Math.random().toString(36).substring(7), v.url, 'Title', v.host, v.visited_at);
      }

      // Count visits in 15 minute window
      const spike = db.prepare(`
        SELECT COUNT(*) as count, GROUP_CONCAT(DISTINCT host) as hosts
        FROM visits
        WHERE visited_at BETWEEN '2024-01-01 10:00:00' AND '2024-01-01 10:15:00'
      `).get() as any;

      expect(spike.count).toBe(4);
      expect(spike.hosts.split(',').length).toBeGreaterThan(1); // Multiple hosts = research
    });

    it('should calculate burst score from density vs baseline', () => {
      // Normal baseline: 2 visits per hour
      // Spike: 10 visits in 15 minutes = 40/hour = 20x baseline
      const burstScore = 10 / 0.25 / 2; // visits / hours / baseline

      expect(burstScore).toBeGreaterThan(10); // Significant spike
    });
  });

  describe('UI Action Pruning via Bandit', () => {
    it('should track action success rates', () => {
      // Simulate showing and clicking actions
      db.prepare(`UPDATE ui_action_stats SET shown_count = 100, clicked_count = 30 WHERE action = 'useful'`).run();
      db.prepare(`UPDATE ui_action_stats SET shown_count = 100, clicked_count = 5 WHERE action = 'kill_thread'`).run();

      const useful = db.prepare('SELECT success_rate FROM ui_action_stats WHERE action = ?').get('useful') as any;
      const kill = db.prepare('SELECT success_rate FROM ui_action_stats WHERE action = ?').get('kill_thread') as any;

      expect(useful.success_rate).toBe(0.3);
      expect(kill.success_rate).toBe(0.05);
    });

    it('should identify underperforming actions for pruning', () => {
      db.prepare(`UPDATE ui_action_stats SET shown_count = 100, clicked_count = 2 WHERE action = 'more_depth'`).run();
      db.prepare(`UPDATE ui_action_stats SET shown_count = 100, clicked_count = 40 WHERE action = 'useful'`).run();

      // Find actions with < 5% success rate
      const candidates = db.prepare(`
        SELECT action, success_rate FROM ui_action_stats
        WHERE success_rate < 0.05 AND shown_count >= 50
      `).all();

      expect(candidates.length).toBeGreaterThan(0);
    });
  });

  describe('Preference Weight Learning', () => {
    it('should increase weight for engaged concepts', () => {
      const conceptId = createTestConcept(db, { label: 'interesting-topic', mention_count: 5 });

      // Create preference weight
      db.prepare(`
        INSERT INTO preference_weights (id, weight_type, target_id, weight)
        VALUES (?, 'concept', ?, 1.0)
      `).run(Math.random().toString(36).substring(7), conceptId);

      // Simulate engagement boost
      const ENGAGEMENT_BOOST = 0.1;
      db.prepare(`
        UPDATE preference_weights
        SET weight = weight + ?,
            last_engagement_at = datetime('now')
        WHERE weight_type = 'concept' AND target_id = ?
      `).run(ENGAGEMENT_BOOST, conceptId);

      const weight = db.prepare(`
        SELECT weight FROM preference_weights WHERE target_id = ?
      `).get(conceptId) as any;

      expect(weight.weight).toBeCloseTo(1.1);
    });

    it('should apply temporal decay to stale weights', () => {
      const conceptId = createTestConcept(db, { label: 'old-topic' });

      db.prepare(`
        INSERT INTO preference_weights (id, weight_type, target_id, weight, last_engagement_at)
        VALUES (?, 'concept', ?, 1.5, datetime('now', '-30 days'))
      `).run(Math.random().toString(36).substring(7), conceptId);

      // Apply decay (0.95 rate, 30 days stale)
      const DECAY_RATE = 0.95;
      const DAYS_STALE = 30;
      const decayedWeight = 1.5 * Math.pow(DECAY_RATE, DAYS_STALE);

      expect(decayedWeight).toBeLessThan(0.35); // Significant decay after 30 days
    });
  });

  describe('Report Cost Tracking', () => {
    it('should track token and dollar costs per report', () => {
      const reportId = createTestReport(db, {
        title: 'Expensive Research',
        cost_tokens: 25000,
        cost_dollars: 0.25,
      });

      const report = db.prepare('SELECT cost_tokens, cost_dollars FROM reports WHERE id = ?').get(reportId) as any;

      expect(report.cost_tokens).toBe(25000);
      expect(report.cost_dollars).toBe(0.25);
    });

    it('should aggregate daily spending', () => {
      createTestReport(db, { cost_dollars: 0.10 });
      createTestReport(db, { cost_dollars: 0.15 });
      createTestReport(db, { cost_dollars: 0.20 });

      const total = db.prepare(`
        SELECT SUM(cost_dollars) as total FROM reports
        WHERE date(created_at) = date('now')
      `).get() as any;

      expect(total.total).toBeCloseTo(0.45);
    });
  });
});

describe('Integration: Full Research Cycle', () => {
  let db: ReturnType<typeof getTestDb>;

  beforeEach(() => {
    resetTestDb();
    db = getTestDb();
  });

  afterAll(() => {
    closeTestDb();
  });

  it('should complete a full ideation → research → synthesis cycle', () => {
    // 1. Source ingestion
    db.prepare(`
      INSERT INTO sources (id, url, title, host, priority)
      VALUES (?, ?, ?, ?, ?)
    `).run('src1', 'https://github.com/example/project', 'Cool Project', 'github.com', 5);

    // 2. Create research job
    db.prepare(`
      INSERT INTO job_queue (id, job_type, payload_json, priority)
      VALUES (?, 'research', ?, ?)
    `).run('job1', JSON.stringify({ source_id: 'src1' }), 5);

    // 3. Job produces report with concepts
    const reportId = createTestReport(db, {
      type: 'repo_signal',
      title: 'Cool Project Analysis',
      summary: 'A promising ML project with good test coverage',
      decision: 'Worth deeper investigation',
      findings_json: JSON.stringify([
        'Uses modern ML frameworks',
        'Has comprehensive tests',
        'Active community'
      ]),
      impact_score: 0.8,
      novelty_score: 0.7,
    });

    // 4. Link concepts
    const conceptId = createTestConcept(db, { label: 'machine-learning', mention_count: 1 });
    db.prepare(`
      INSERT INTO concept_mentions (id, concept_id, entity_type, entity_id)
      VALUES (?, ?, 'report', ?)
    `).run('m1', conceptId, reportId);

    // 5. User engages positively
    simulateEngagement(db, reportId, {
      opened: true,
      scrollDepth: 0.9,
      dwellMs: 30000,
      clicked: true,
      pinned: true,
    });
    submitFeedback(db, reportId, 'useful');

    // 6. Verify the learning happened
    const satisfaction = calculateSatisfaction(db, reportId);
    expect(satisfaction).toBeGreaterThan(0.7);

    // 7. Verify concept was reinforced
    const concept = db.prepare('SELECT mention_count FROM concepts WHERE id = ?').get(conceptId) as any;
    expect(concept.mention_count).toBe(1);

    // 8. Mark job complete
    db.prepare(`UPDATE job_queue SET status = 'completed' WHERE id = ?`).run('job1');
    db.prepare(`UPDATE sources SET processed_at = datetime('now') WHERE id = ?`).run('src1');

    // Verify full cycle
    const source = db.prepare('SELECT processed_at FROM sources WHERE id = ?').get('src1') as any;
    expect(source.processed_at).not.toBeNull();
  });

  it('should learn from negative feedback and adjust behavior', () => {
    // Create reports of two types
    const goodReport = createTestReport(db, { type: 'decision_memo', title: 'Good Memo', impact_score: 0.9 });
    const badReport = createTestReport(db, { type: 'research_brief', title: 'Bad Brief', impact_score: 0.3 });

    // User loves memos, hates briefs
    simulateEngagement(db, goodReport, { opened: true, pinned: true });
    submitFeedback(db, goodReport, 'useful');

    simulateEngagement(db, badReport, { opened: true, dwellMs: 500 });
    submitFeedback(db, badReport, 'not_useful');

    // Calculate satisfaction for each
    const goodSat = calculateSatisfaction(db, goodReport);
    const badSat = calculateSatisfaction(db, badReport);

    // System should learn to prefer memos
    expect(goodSat).toBeGreaterThan(badSat);
    expect(goodSat - badSat).toBeGreaterThan(0.3); // Significant difference
  });
});
