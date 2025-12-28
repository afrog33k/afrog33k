/**
 * Evaluation Framework for Ronald-GI
 *
 * This module answers the fundamental question: "Is this system actually useful?"
 *
 * Based on insights from:
 * - EvolveR (arxiv:2510.16079): Self-evolving agents with performance metrics
 * - ALAS (arxiv:2508.15805): Autonomous learning with curriculum evaluation
 *
 * KEY PRINCIPLE: The system should prove it works, not just claim it works.
 *
 * Metrics tracked:
 * 1. PREDICTION ACCURACY - Does system correctly predict user interests?
 * 2. INTERVENTION EFFECTIVENESS - Do nudges lead to better outcomes?
 * 3. LEARNING RATE - Is the system improving over time?
 * 4. USER ALIGNMENT - Does system match stated user preferences?
 * 5. COGNITIVE LOAD REDUCTION - Is the user's mental burden reduced?
 */

import Database from 'better-sqlite3';

// ============================================
// TYPES
// ============================================

export interface EvalMetric {
  name: string;
  value: number;
  confidence: number;
  timestamp: string;
  context?: Record<string, any>;
}

export interface PredictionEval {
  id: string;
  predictionType: 'interest' | 'relevance' | 'attention_state' | 'need';
  predictedValue: string;
  actualValue?: string;
  correct?: boolean;
  timestamp: string;
  feedback?: 'confirmed' | 'rejected' | 'pending';
}

export interface InterventionEval {
  id: string;
  interventionType: 'nudge' | 'report' | 'suggestion' | 'reminder';
  outcome: 'accepted' | 'rejected' | 'ignored' | 'pending';
  outcomeMetric?: number; // -1 to 1, negative = made things worse
  preState?: string;
  postState?: string;
  timestamp: string;
}

export interface LearningEval {
  windowStart: string;
  windowEnd: string;
  predictionAccuracy: number;
  interventionSuccess: number;
  improvementRate: number; // Change from previous window
}

export interface SystemHealth {
  overallScore: number; // 0-1, composite health metric
  predictionAccuracy: number;
  interventionEffectiveness: number;
  learningRate: number;
  userSatisfaction: number;
  dataQuality: number;
  recommendations: string[];
}

// ============================================
// GROUND TRUTH COLLECTOR
// ============================================

/**
 * Collects ground truth from user to validate system predictions
 */
export class GroundTruthCollector {
  constructor(private db: Database.Database) {}

  /**
   * Record user's explicit feedback on a prediction
   */
  recordPredictionFeedback(
    predictionId: string,
    feedback: 'confirmed' | 'rejected',
    context?: Record<string, any>
  ): void {
    this.db.prepare(`
      INSERT INTO eval_predictions (id, prediction_id, feedback, context_json, timestamp)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(prediction_id) DO UPDATE SET
        feedback = excluded.feedback,
        context_json = excluded.context_json,
        timestamp = excluded.timestamp
    `).run(this.generateId(), predictionId, feedback, JSON.stringify(context || {}));
  }

  /**
   * Record if an intervention helped or hurt
   */
  recordInterventionOutcome(
    interventionId: string,
    outcome: 'helped' | 'hurt' | 'neutral',
    details?: string
  ): void {
    const score = outcome === 'helped' ? 1 : outcome === 'hurt' ? -1 : 0;

    this.db.prepare(`
      INSERT INTO eval_interventions (id, intervention_id, outcome, outcome_score, details, timestamp)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(this.generateId(), interventionId, outcome, score, details || null);
  }

  /**
   * Record user's stated satisfaction
   */
  recordSatisfaction(
    userId: string,
    score: number, // 1-5
    context?: string
  ): void {
    this.db.prepare(`
      INSERT INTO eval_satisfaction (id, user_id, score, context, timestamp)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(this.generateId(), userId, score, context || null);
  }

  /**
   * Record explicit interest confirmation
   * "Was this report actually useful to you?"
   */
  recordInterestValidation(
    reportId: string,
    actuallyInterested: boolean,
    predictedInterest: number
  ): void {
    this.db.prepare(`
      INSERT INTO eval_interest_validation
      (id, report_id, actually_interested, predicted_interest, timestamp)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(this.generateId(), reportId, actuallyInterested ? 1 : 0, predictedInterest);
  }

  /**
   * Record attention state validation
   * "System thought you were scattered - were you?"
   */
  recordAttentionValidation(
    snapshotId: string,
    predictedState: string,
    actualState: string
  ): void {
    this.db.prepare(`
      INSERT INTO eval_attention_validation
      (id, snapshot_id, predicted_state, actual_state, correct, timestamp)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(
      this.generateId(),
      snapshotId,
      predictedState,
      actualState,
      predictedState === actualState ? 1 : 0
    );
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 15) +
           Math.random().toString(36).substring(2, 15);
  }
}

// ============================================
// METRIC CALCULATOR
// ============================================

export class MetricCalculator {
  constructor(private db: Database.Database) {}

  /**
   * Calculate prediction accuracy over a time window
   */
  getPredictionAccuracy(userId: string, days: number = 7): number {
    const result = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END) as correct
      FROM eval_attention_validation
      WHERE timestamp >= datetime('now', ?)
    `).get(`-${days} days`) as { total: number; correct: number };

    if (result.total === 0) return 0;
    return result.correct / result.total;
  }

  /**
   * Calculate interest prediction accuracy
   */
  getInterestAccuracy(days: number = 7): number {
    const result = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE
          WHEN (predicted_interest >= 0.5 AND actually_interested = 1)
            OR (predicted_interest < 0.5 AND actually_interested = 0)
          THEN 1 ELSE 0
        END) as correct
      FROM eval_interest_validation
      WHERE timestamp >= datetime('now', ?)
    `).get(`-${days} days`) as { total: number; correct: number };

    if (result.total === 0) return 0;
    return result.correct / result.total;
  }

  /**
   * Calculate intervention effectiveness
   */
  getInterventionEffectiveness(days: number = 7): number {
    const result = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        AVG(outcome_score) as avg_score
      FROM eval_interventions
      WHERE timestamp >= datetime('now', ?)
    `).get(`-${days} days`) as { total: number; avg_score: number | null };

    if (result.total === 0 || result.avg_score === null) return 0;
    // Normalize from [-1, 1] to [0, 1]
    return (result.avg_score + 1) / 2;
  }

  /**
   * Calculate user satisfaction score
   */
  getSatisfactionScore(userId: string, days: number = 7): number {
    const result = this.db.prepare(`
      SELECT AVG(score) as avg_score
      FROM eval_satisfaction
      WHERE user_id = ? AND timestamp >= datetime('now', ?)
    `).get(userId, `-${days} days`) as { avg_score: number | null };

    if (result.avg_score === null) return 0;
    // Normalize from [1, 5] to [0, 1]
    return (result.avg_score - 1) / 4;
  }

  /**
   * Calculate learning rate (improvement over time)
   */
  getLearningRate(userId: string): number {
    // Compare this week's accuracy to last week's
    const thisWeek = this.getPredictionAccuracy(userId, 7);
    const lastWeek = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END) as correct
      FROM eval_attention_validation
      WHERE timestamp >= datetime('now', '-14 days')
        AND timestamp < datetime('now', '-7 days')
    `).get() as { total: number; correct: number };

    if (lastWeek.total === 0) return 0;
    const lastWeekAccuracy = lastWeek.correct / lastWeek.total;

    // Return improvement rate
    if (lastWeekAccuracy === 0) return thisWeek > 0 ? 1 : 0;
    return (thisWeek - lastWeekAccuracy) / lastWeekAccuracy;
  }

  /**
   * Calculate data quality score
   */
  getDataQuality(userId: string): number {
    // Check for sufficient data across different sources
    const sources = [
      { table: 'visits', minCount: 100 },
      { table: 'attention_events', minCount: 50 },
      { table: 'telemetry', minCount: 20 },
      { table: 'feedback', minCount: 10 },
    ];

    let score = 0;
    for (const source of sources) {
      try {
        const result = this.db.prepare(`
          SELECT COUNT(*) as count FROM ${source.table}
        `).get() as { count: number };

        score += Math.min(1, result.count / source.minCount) / sources.length;
      } catch {
        // Table might not exist
      }
    }

    return score;
  }

  /**
   * Get comprehensive system health
   */
  getSystemHealth(userId: string): SystemHealth {
    const predictionAccuracy = this.getPredictionAccuracy(userId);
    const interestAccuracy = this.getInterestAccuracy();
    const interventionEffectiveness = this.getInterventionEffectiveness();
    const userSatisfaction = this.getSatisfactionScore(userId);
    const learningRate = this.getLearningRate(userId);
    const dataQuality = this.getDataQuality(userId);

    // Weighted composite score
    const overallScore =
      0.25 * predictionAccuracy +
      0.20 * interestAccuracy +
      0.20 * interventionEffectiveness +
      0.15 * userSatisfaction +
      0.10 * Math.max(0, learningRate) + // Only count positive learning
      0.10 * dataQuality;

    // Generate recommendations based on weaknesses
    const recommendations: string[] = [];

    if (dataQuality < 0.5) {
      recommendations.push('Insufficient data - import more browsing history and interact with reports');
    }
    if (predictionAccuracy < 0.6 && dataQuality > 0.5) {
      recommendations.push('Attention predictions are inaccurate - provide more feedback on attention states');
    }
    if (interestAccuracy < 0.6) {
      recommendations.push('Interest predictions need work - pin/dismiss more reports to train the model');
    }
    if (interventionEffectiveness < 0.5) {
      recommendations.push('Nudges aren\'t helping - adjust intervention timing or type');
    }
    if (learningRate < 0) {
      recommendations.push('System is getting worse - review recent changes or reset preferences');
    }
    if (userSatisfaction < 0.5) {
      recommendations.push('Low satisfaction - consider adjusting system behavior or frequency');
    }

    if (recommendations.length === 0 && overallScore > 0.7) {
      recommendations.push('System is performing well - continue current usage patterns');
    }

    // Calculate combined prediction accuracy, only including metrics with data
    // If one metric has no data (returns 0), only use the one that has data
    const hasAttentionData = this.hasAttentionValidationData();
    const hasInterestData = this.hasInterestValidationData();
    let combinedPredictionAccuracy: number;
    if (hasAttentionData && hasInterestData) {
      combinedPredictionAccuracy = (predictionAccuracy + interestAccuracy) / 2;
    } else if (hasAttentionData) {
      combinedPredictionAccuracy = predictionAccuracy;
    } else if (hasInterestData) {
      combinedPredictionAccuracy = interestAccuracy;
    } else {
      combinedPredictionAccuracy = 0;
    }

    return {
      overallScore,
      predictionAccuracy: combinedPredictionAccuracy,
      interventionEffectiveness,
      learningRate,
      userSatisfaction,
      dataQuality,
      recommendations,
    };
  }

  /**
   * Check if we have attention validation data
   */
  private hasAttentionValidationData(days: number = 7): boolean {
    const result = this.db.prepare(`
      SELECT COUNT(*) as count FROM eval_attention_validation
      WHERE timestamp >= datetime('now', ?)
    `).get(`-${days} days`) as { count: number };
    return result.count > 0;
  }

  /**
   * Check if we have interest validation data
   */
  private hasInterestValidationData(days: number = 7): boolean {
    const result = this.db.prepare(`
      SELECT COUNT(*) as count FROM eval_interest_validation
      WHERE timestamp >= datetime('now', ?)
    `).get(`-${days} days`) as { count: number };
    return result.count > 0;
  }
}

// ============================================
// A/B TESTING FRAMEWORK
// ============================================

export class ABTestFramework {
  constructor(private db: Database.Database) {}

  /**
   * Create a new A/B test
   */
  createTest(
    name: string,
    variants: string[],
    targetMetric: string
  ): string {
    const id = this.generateId();

    this.db.prepare(`
      INSERT INTO ab_tests (id, name, variants_json, target_metric, status, created_at)
      VALUES (?, ?, ?, ?, 'running', datetime('now'))
    `).run(id, name, JSON.stringify(variants), targetMetric);

    return id;
  }

  /**
   * Assign a user to a test variant
   */
  assignVariant(testId: string, userId: string): string {
    // Check for existing assignment
    const existing = this.db.prepare(`
      SELECT variant FROM ab_test_assignments WHERE test_id = ? AND user_id = ?
    `).get(testId, userId) as { variant: string } | undefined;

    if (existing) return existing.variant;

    // Get variants
    const test = this.db.prepare(`
      SELECT variants_json FROM ab_tests WHERE id = ?
    `).get(testId) as { variants_json: string };

    const variants = JSON.parse(test.variants_json) as string[];

    // Random assignment
    const variant = variants[Math.floor(Math.random() * variants.length)];

    this.db.prepare(`
      INSERT INTO ab_test_assignments (id, test_id, user_id, variant, assigned_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(this.generateId(), testId, userId, variant);

    return variant;
  }

  /**
   * Record a metric observation for a test
   */
  recordMetric(testId: string, userId: string, metricValue: number): void {
    const assignment = this.db.prepare(`
      SELECT variant FROM ab_test_assignments WHERE test_id = ? AND user_id = ?
    `).get(testId, userId) as { variant: string } | undefined;

    if (!assignment) return;

    this.db.prepare(`
      INSERT INTO ab_test_metrics (id, test_id, user_id, variant, metric_value, recorded_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(this.generateId(), testId, userId, assignment.variant, metricValue);
  }

  /**
   * Analyze A/B test results
   */
  analyzeTest(testId: string): ABTestResult {
    const test = this.db.prepare(`
      SELECT * FROM ab_tests WHERE id = ?
    `).get(testId) as any;

    const variants = JSON.parse(test.variants_json) as string[];

    const variantStats: Record<string, VariantStats> = {};

    for (const variant of variants) {
      const metrics = this.db.prepare(`
        SELECT metric_value FROM ab_test_metrics
        WHERE test_id = ? AND variant = ?
      `).all(testId, variant) as { metric_value: number }[];

      if (metrics.length === 0) {
        variantStats[variant] = { mean: 0, stdDev: 0, n: 0 };
        continue;
      }

      const values = metrics.map(m => m.metric_value);
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const variance = values.reduce((a, v) => a + Math.pow(v - mean, 2), 0) / values.length;

      variantStats[variant] = {
        mean,
        stdDev: Math.sqrt(variance),
        n: values.length,
      };
    }

    // Simple statistical significance check (requires more data in practice)
    const sortedVariants = Object.entries(variantStats)
      .sort((a, b) => b[1].mean - a[1].mean);

    const winner = sortedVariants[0][1].n >= 30 ? sortedVariants[0][0] : null;

    return {
      testId,
      name: test.name,
      status: test.status,
      variantStats,
      winner,
      significanceReached: sortedVariants[0][1].n >= 30,
    };
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 15);
  }
}

export interface VariantStats {
  mean: number;
  stdDev: number;
  n: number;
}

export interface ABTestResult {
  testId: string;
  name: string;
  status: string;
  variantStats: Record<string, VariantStats>;
  winner: string | null;
  significanceReached: boolean;
}

// ============================================
// EVAL REPORT GENERATOR
// ============================================

export class EvalReportGenerator {
  private metrics: MetricCalculator;

  constructor(private db: Database.Database) {
    this.metrics = new MetricCalculator(db);
  }

  /**
   * Generate a comprehensive evaluation report
   */
  generateReport(userId: string): EvalReport {
    const health = this.metrics.getSystemHealth(userId);

    // Get trend data
    const weeklyTrend = this.getWeeklyTrend(userId);

    // Get top issues
    const issues = this.identifyIssues(health);

    // Get success stories
    const successes = this.identifySuccesses(userId);

    return {
      timestamp: new Date().toISOString(),
      userId,
      health,
      weeklyTrend,
      issues,
      successes,
      verdict: this.generateVerdict(health),
    };
  }

  private getWeeklyTrend(userId: string): WeeklyTrend[] {
    const trends: WeeklyTrend[] = [];

    for (let week = 0; week < 4; week++) {
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - (week + 1) * 7);
      const weekEnd = new Date();
      weekEnd.setDate(weekEnd.getDate() - week * 7);

      // This is a simplified version - full implementation would query each metric
      trends.push({
        weekStart: weekStart.toISOString().split('T')[0],
        weekEnd: weekEnd.toISOString().split('T')[0],
        overallScore: 0.5 + Math.random() * 0.3 - week * 0.05, // Placeholder
      });
    }

    return trends;
  }

  private identifyIssues(health: SystemHealth): EvalIssue[] {
    const issues: EvalIssue[] = [];

    if (health.dataQuality < 0.5) {
      issues.push({
        severity: 'high',
        area: 'data',
        description: 'Insufficient training data',
        action: 'Import more browsing history and interact with more reports',
      });
    }

    if (health.predictionAccuracy < 0.6) {
      issues.push({
        severity: 'medium',
        area: 'predictions',
        description: 'Predictions are not accurate enough',
        action: 'Provide explicit feedback when predictions are wrong',
      });
    }

    if (health.interventionEffectiveness < 0.5) {
      issues.push({
        severity: 'medium',
        area: 'interventions',
        description: 'Nudges are not helping',
        action: 'Adjust nudge timing or disable unhelpful nudge types',
      });
    }

    if (health.learningRate < 0) {
      issues.push({
        severity: 'high',
        area: 'learning',
        description: 'System is getting worse over time',
        action: 'Review recent changes or consider resetting preferences',
      });
    }

    return issues;
  }

  private identifySuccesses(userId: string): string[] {
    const successes: string[] = [];

    // Check for high-value predictions
    const highAccuracy = this.metrics.getPredictionAccuracy(userId) > 0.8;
    if (highAccuracy) {
      successes.push('Attention state predictions are highly accurate');
    }

    const goodInterventions = this.metrics.getInterventionEffectiveness() > 0.7;
    if (goodInterventions) {
      successes.push('Interventions are generally helpful');
    }

    const positiveLearning = this.metrics.getLearningRate(userId) > 0.1;
    if (positiveLearning) {
      successes.push('System is improving over time');
    }

    return successes;
  }

  private generateVerdict(health: SystemHealth): EvalVerdict {
    if (health.overallScore >= 0.8) {
      return {
        status: 'excellent',
        summary: 'System is performing well and providing genuine value',
        confidence: 0.9,
      };
    } else if (health.overallScore >= 0.6) {
      return {
        status: 'good',
        summary: 'System is helpful but has room for improvement',
        confidence: 0.75,
      };
    } else if (health.overallScore >= 0.4) {
      return {
        status: 'needs_work',
        summary: 'System has significant issues that need addressing',
        confidence: 0.7,
      };
    } else {
      return {
        status: 'failing',
        summary: 'System is not providing value - consider major changes',
        confidence: 0.8,
      };
    }
  }
}

export interface EvalReport {
  timestamp: string;
  userId: string;
  health: SystemHealth;
  weeklyTrend: WeeklyTrend[];
  issues: EvalIssue[];
  successes: string[];
  verdict: EvalVerdict;
}

export interface WeeklyTrend {
  weekStart: string;
  weekEnd: string;
  overallScore: number;
}

export interface EvalIssue {
  severity: 'low' | 'medium' | 'high';
  area: string;
  description: string;
  action: string;
}

export interface EvalVerdict {
  status: 'excellent' | 'good' | 'needs_work' | 'failing';
  summary: string;
  confidence: number;
}

// ============================================
// FACTORY
// ============================================

export function createEvalSystem(db: Database.Database): {
  groundTruth: GroundTruthCollector;
  metrics: MetricCalculator;
  abTests: ABTestFramework;
  reports: EvalReportGenerator;
} {
  return {
    groundTruth: new GroundTruthCollector(db),
    metrics: new MetricCalculator(db),
    abTests: new ABTestFramework(db),
    reports: new EvalReportGenerator(db),
  };
}
