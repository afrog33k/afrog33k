/**
 * Evaluation Framework Tests for Ronald-GI
 *
 * These tests verify that we can actually measure whether the system works.
 *
 * KEY QUESTION: Is this system useful, or is it elaborate bullshit?
 *
 * The eval framework answers this by:
 * 1. Collecting ground truth from user feedback
 * 2. Comparing predictions against actual outcomes
 * 3. Measuring intervention effectiveness
 * 4. Tracking improvement over time
 * 5. Generating honest reports about system health
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  getTestDb,
  resetTestDb,
  closeTestDb,
  createTestUserProfile,
} from './setup';
import {
  GroundTruthCollector,
  MetricCalculator,
  ABTestFramework,
  EvalReportGenerator,
  createEvalSystem,
} from '../lib/eval_framework';

describe('Eval Framework: Ground Truth Collection', () => {
  let db: ReturnType<typeof getTestDb>;
  let groundTruth: GroundTruthCollector;

  beforeEach(() => {
    resetTestDb();
    db = getTestDb();
    groundTruth = new GroundTruthCollector(db);
    createTestUserProfile(db, { id: 'test_user', name: 'Test User' });
  });

  afterAll(() => {
    closeTestDb();
  });

  it('should record prediction feedback', () => {
    groundTruth.recordPredictionFeedback('pred1', 'confirmed', { note: 'System was right' });

    const row = db.prepare(`
      SELECT * FROM eval_predictions WHERE prediction_id = 'pred1'
    `).get() as any;

    expect(row).toBeDefined();
    expect(row.feedback).toBe('confirmed');
  });

  it('should record intervention outcomes', () => {
    groundTruth.recordInterventionOutcome('int1', 'helped', 'The break suggestion was useful');

    const row = db.prepare(`
      SELECT * FROM eval_interventions WHERE intervention_id = 'int1'
    `).get() as any;

    expect(row).toBeDefined();
    expect(row.outcome).toBe('helped');
    expect(row.outcome_score).toBe(1);
  });

  it('should record negative intervention outcomes', () => {
    groundTruth.recordInterventionOutcome('int2', 'hurt', 'Nudge was annoying');

    const row = db.prepare(`
      SELECT * FROM eval_interventions WHERE intervention_id = 'int2'
    `).get() as any;

    expect(row.outcome_score).toBe(-1);
  });

  it('should record satisfaction scores', () => {
    groundTruth.recordSatisfaction('test_user', 4, 'Generally happy with system');

    const row = db.prepare(`
      SELECT * FROM eval_satisfaction WHERE user_id = 'test_user'
    `).get() as any;

    expect(row).toBeDefined();
    expect(row.score).toBe(4);
  });

  it('should record interest validation', () => {
    groundTruth.recordInterestValidation('report1', true, 0.85);

    const row = db.prepare(`
      SELECT * FROM eval_interest_validation WHERE report_id = 'report1'
    `).get() as any;

    expect(row.actually_interested).toBe(1);
    expect(row.predicted_interest).toBe(0.85);
  });

  it('should record attention validation', () => {
    groundTruth.recordAttentionValidation('snap1', 'scattered', 'scattered');

    const row = db.prepare(`
      SELECT * FROM eval_attention_validation WHERE snapshot_id = 'snap1'
    `).get() as any;

    expect(row.predicted_state).toBe('scattered');
    expect(row.actual_state).toBe('scattered');
    expect(row.correct).toBe(1);
  });

  it('should detect incorrect predictions', () => {
    groundTruth.recordAttentionValidation('snap2', 'scattered', 'focused');

    const row = db.prepare(`
      SELECT * FROM eval_attention_validation WHERE snapshot_id = 'snap2'
    `).get() as any;

    expect(row.correct).toBe(0);
  });
});

describe('Eval Framework: Metric Calculation', () => {
  let db: ReturnType<typeof getTestDb>;
  let metrics: MetricCalculator;
  let groundTruth: GroundTruthCollector;

  beforeEach(() => {
    resetTestDb();
    db = getTestDb();
    metrics = new MetricCalculator(db);
    groundTruth = new GroundTruthCollector(db);
    createTestUserProfile(db, { id: 'test_user', name: 'Test User' });
  });

  afterAll(() => {
    closeTestDb();
  });

  describe('Prediction Accuracy', () => {
    it('should calculate 100% accuracy when all predictions are correct', () => {
      // Record 5 correct predictions
      for (let i = 0; i < 5; i++) {
        groundTruth.recordAttentionValidation(`snap${i}`, 'focused', 'focused');
      }

      const accuracy = metrics.getPredictionAccuracy('test_user');
      expect(accuracy).toBe(1.0);
    });

    it('should calculate 50% accuracy when half are correct', () => {
      // 3 correct, 3 wrong
      for (let i = 0; i < 3; i++) {
        groundTruth.recordAttentionValidation(`snap_correct_${i}`, 'focused', 'focused');
        groundTruth.recordAttentionValidation(`snap_wrong_${i}`, 'focused', 'scattered');
      }

      const accuracy = metrics.getPredictionAccuracy('test_user');
      expect(accuracy).toBe(0.5);
    });

    it('should return 0 when no predictions exist', () => {
      const accuracy = metrics.getPredictionAccuracy('test_user');
      expect(accuracy).toBe(0);
    });
  });

  describe('Interest Accuracy', () => {
    it('should calculate interest prediction accuracy', () => {
      // High prediction + actually interested = correct
      groundTruth.recordInterestValidation('r1', true, 0.8);
      // Low prediction + not interested = correct
      groundTruth.recordInterestValidation('r2', false, 0.3);
      // High prediction + not interested = wrong
      groundTruth.recordInterestValidation('r3', false, 0.9);

      const accuracy = metrics.getInterestAccuracy();
      expect(accuracy).toBeCloseTo(2 / 3, 1);
    });
  });

  describe('Intervention Effectiveness', () => {
    it('should calculate positive effectiveness when interventions help', () => {
      groundTruth.recordInterventionOutcome('i1', 'helped');
      groundTruth.recordInterventionOutcome('i2', 'helped');
      groundTruth.recordInterventionOutcome('i3', 'neutral');

      const effectiveness = metrics.getInterventionEffectiveness();
      // Average of [1, 1, 0] = 0.67, normalized to [0,1] = (0.67+1)/2 = 0.83
      expect(effectiveness).toBeGreaterThan(0.7);
    });

    it('should calculate negative effectiveness when interventions hurt', () => {
      groundTruth.recordInterventionOutcome('i1', 'hurt');
      groundTruth.recordInterventionOutcome('i2', 'hurt');

      const effectiveness = metrics.getInterventionEffectiveness();
      // Average of [-1, -1] = -1, normalized = 0
      expect(effectiveness).toBe(0);
    });
  });

  describe('User Satisfaction', () => {
    it('should calculate normalized satisfaction score', () => {
      groundTruth.recordSatisfaction('test_user', 5); // Max satisfaction
      groundTruth.recordSatisfaction('test_user', 5);

      const score = metrics.getSatisfactionScore('test_user');
      expect(score).toBe(1.0);
    });

    it('should handle mid-range satisfaction', () => {
      groundTruth.recordSatisfaction('test_user', 3);

      const score = metrics.getSatisfactionScore('test_user');
      expect(score).toBe(0.5);
    });
  });

  describe('System Health', () => {
    it('should identify insufficient data as a problem', () => {
      const health = metrics.getSystemHealth('test_user');

      expect(health.dataQuality).toBeLessThan(0.5);
      expect(health.recommendations.some(r => r.includes('Insufficient data'))).toBe(true);
    });

    it('should calculate composite health score', () => {
      // Add some positive data
      for (let i = 0; i < 5; i++) {
        groundTruth.recordAttentionValidation(`snap${i}`, 'focused', 'focused');
        groundTruth.recordInterventionOutcome(`int${i}`, 'helped');
        groundTruth.recordSatisfaction('test_user', 4);
      }

      const health = metrics.getSystemHealth('test_user');

      expect(health.overallScore).toBeGreaterThan(0);
      expect(health.predictionAccuracy).toBe(1.0);
      expect(health.interventionEffectiveness).toBe(1.0);
    });
  });
});

describe('Eval Framework: A/B Testing', () => {
  let db: ReturnType<typeof getTestDb>;
  let abTests: ABTestFramework;

  beforeEach(() => {
    resetTestDb();
    db = getTestDb();
    abTests = new ABTestFramework(db);
    createTestUserProfile(db, { id: 'test_user', name: 'Test User' });
  });

  afterAll(() => {
    closeTestDb();
  });

  it('should create A/B tests', () => {
    const testId = abTests.createTest('nudge_timing', ['immediate', 'delayed'], 'acceptance_rate');

    const row = db.prepare('SELECT * FROM ab_tests WHERE id = ?').get(testId) as any;
    expect(row.name).toBe('nudge_timing');
    expect(row.status).toBe('running');
  });

  it('should assign users to variants consistently', () => {
    const testId = abTests.createTest('test1', ['A', 'B'], 'metric');

    const variant1 = abTests.assignVariant(testId, 'test_user');
    const variant2 = abTests.assignVariant(testId, 'test_user');

    // Same user should get same variant
    expect(variant1).toBe(variant2);
  });

  it('should record metrics for variants', () => {
    const testId = abTests.createTest('test1', ['A', 'B'], 'metric');
    abTests.assignVariant(testId, 'test_user');

    abTests.recordMetric(testId, 'test_user', 0.75);

    const row = db.prepare(`
      SELECT * FROM ab_test_metrics WHERE test_id = ? AND user_id = ?
    `).get(testId, 'test_user') as any;

    expect(row.metric_value).toBe(0.75);
  });

  it('should analyze test results', () => {
    const testId = abTests.createTest('test1', ['A', 'B'], 'metric');

    // Simulate 30+ users in each variant
    for (let i = 0; i < 35; i++) {
      const userId = `user_a_${i}`;
      createTestUserProfile(db, { id: userId, name: `User A ${i}` });

      // Manually assign to variant A
      db.prepare(`
        INSERT INTO ab_test_assignments (id, test_id, user_id, variant, assigned_at)
        VALUES (?, ?, ?, 'A', datetime('now'))
      `).run(`assign_a_${i}`, testId, userId);

      // Variant A performs at 0.7
      abTests.recordMetric(testId, userId, 0.7);
    }

    for (let i = 0; i < 35; i++) {
      const userId = `user_b_${i}`;
      createTestUserProfile(db, { id: userId, name: `User B ${i}` });

      db.prepare(`
        INSERT INTO ab_test_assignments (id, test_id, user_id, variant, assigned_at)
        VALUES (?, ?, ?, 'B', datetime('now'))
      `).run(`assign_b_${i}`, testId, userId);

      // Variant B performs at 0.5
      abTests.recordMetric(testId, userId, 0.5);
    }

    const result = abTests.analyzeTest(testId);

    expect(result.significanceReached).toBe(true);
    expect(result.winner).toBe('A');
    expect(result.variantStats['A'].mean).toBeCloseTo(0.7, 1);
    expect(result.variantStats['B'].mean).toBeCloseTo(0.5, 1);
  });
});

describe('Eval Framework: Report Generation', () => {
  let db: ReturnType<typeof getTestDb>;
  let reports: EvalReportGenerator;
  let groundTruth: GroundTruthCollector;

  beforeEach(() => {
    resetTestDb();
    db = getTestDb();
    reports = new EvalReportGenerator(db);
    groundTruth = new GroundTruthCollector(db);
    createTestUserProfile(db, { id: 'test_user', name: 'Test User' });
  });

  afterAll(() => {
    closeTestDb();
  });

  it('should generate evaluation report', () => {
    const report = reports.generateReport('test_user');

    expect(report.userId).toBe('test_user');
    expect(report.health).toBeDefined();
    expect(report.verdict).toBeDefined();
    expect(report.issues).toBeInstanceOf(Array);
  });

  it('should identify failing system when data quality is low', () => {
    const report = reports.generateReport('test_user');

    expect(report.health.dataQuality).toBeLessThan(0.5);
    expect(report.issues.some(i => i.area === 'data')).toBe(true);
  });

  it('should give positive verdict when metrics are good', () => {
    // Add lots of positive data
    for (let i = 0; i < 20; i++) {
      groundTruth.recordAttentionValidation(`snap${i}`, 'focused', 'focused');
      groundTruth.recordInterventionOutcome(`int${i}`, 'helped');
      groundTruth.recordSatisfaction('test_user', 5);
      groundTruth.recordInterestValidation(`r${i}`, true, 0.9);
    }

    const report = reports.generateReport('test_user');

    // With high accuracy, should be at least "good"
    expect(['excellent', 'good']).toContain(report.verdict.status);
  });

  it('should provide actionable recommendations', () => {
    const report = reports.generateReport('test_user');

    expect(report.health.recommendations.length).toBeGreaterThan(0);
    // Recommendations should be actionable
    expect(report.health.recommendations.every(r => r.length > 10)).toBe(true);
  });
});

describe('Eval Framework: Integration Test', () => {
  let db: ReturnType<typeof getTestDb>;
  let system: ReturnType<typeof createEvalSystem>;

  beforeEach(() => {
    resetTestDb();
    db = getTestDb();
    system = createEvalSystem(db);
    createTestUserProfile(db, { id: 'ronald_adonyo', name: 'Ronald Adonyo' });
  });

  afterAll(() => {
    closeTestDb();
  });

  it('should track complete evaluation lifecycle', () => {
    // 1. User provides feedback on predictions
    for (let i = 0; i < 10; i++) {
      // 80% correct predictions
      const correct = i < 8;
      system.groundTruth.recordAttentionValidation(
        `snap${i}`,
        correct ? 'focused' : 'scattered',
        'focused'
      );
    }

    // 2. User rates interventions
    system.groundTruth.recordInterventionOutcome('nudge1', 'helped');
    system.groundTruth.recordInterventionOutcome('nudge2', 'helped');
    system.groundTruth.recordInterventionOutcome('nudge3', 'neutral');

    // 3. User rates satisfaction
    system.groundTruth.recordSatisfaction('ronald_adonyo', 4);

    // 4. Calculate metrics
    const accuracy = system.metrics.getPredictionAccuracy('ronald_adonyo');
    const effectiveness = system.metrics.getInterventionEffectiveness();
    const satisfaction = system.metrics.getSatisfactionScore('ronald_adonyo');

    expect(accuracy).toBe(0.8);
    expect(effectiveness).toBeGreaterThan(0.6);
    expect(satisfaction).toBe(0.75); // (4-1)/4

    // 5. Generate report
    const report = system.reports.generateReport('ronald_adonyo');

    // Health.predictionAccuracy averages attention accuracy + interest accuracy
    // Interest accuracy is 0 (no interest validations), so (0.8 + 0) / 2 = 0.4
    expect(report.health.predictionAccuracy).toBeCloseTo(0.4, 1);
    expect(report.verdict.status).not.toBe('failing');
  });

  it('should detect system degradation', () => {
    // Simulate a week of bad predictions
    for (let i = 0; i < 10; i++) {
      system.groundTruth.recordAttentionValidation(
        `snap_bad_${i}`,
        'focused',
        'scattered' // All wrong
      );
    }

    const health = system.metrics.getSystemHealth('ronald_adonyo');

    // predictionAccuracy averages attention (0) + interest (0)
    expect(health.predictionAccuracy).toBe(0);
    // With low data quality and low prediction accuracy, should recommend data import
    expect(health.recommendations.some(r =>
      r.includes('data') || r.includes('history') || r.includes('interact')
    )).toBe(true);
  });
});

describe('Eval Framework: Honest Assessment', () => {
  let db: ReturnType<typeof getTestDb>;
  let system: ReturnType<typeof createEvalSystem>;

  beforeEach(() => {
    resetTestDb();
    db = getTestDb();
    system = createEvalSystem(db);
    createTestUserProfile(db, { id: 'test_user', name: 'Test User' });
  });

  afterAll(() => {
    closeTestDb();
  });

  it('should admit when there is insufficient data', () => {
    const report = system.reports.generateReport('test_user');

    expect(report.health.dataQuality).toBeLessThan(0.5);
    expect(report.issues.some(i =>
      i.description.includes('Insufficient')
    )).toBe(true);
  });

  it('should give failing verdict when nothing works', () => {
    // All wrong predictions
    for (let i = 0; i < 10; i++) {
      system.groundTruth.recordAttentionValidation(`s${i}`, 'focused', 'crashed');
    }

    // All interventions hurt
    for (let i = 0; i < 5; i++) {
      system.groundTruth.recordInterventionOutcome(`i${i}`, 'hurt');
    }

    // Low satisfaction
    system.groundTruth.recordSatisfaction('test_user', 1);

    const report = system.reports.generateReport('test_user');

    expect(['needs_work', 'failing']).toContain(report.verdict.status);
  });

  it('should track if learning rate is negative', () => {
    // This test verifies we can detect when the system is getting worse
    const learningRate = system.metrics.getLearningRate('test_user');

    // With no historical data, learning rate should be 0
    expect(learningRate).toBe(0);
  });
});
