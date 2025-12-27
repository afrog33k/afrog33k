/**
 * Self-Evolution Loop for Ronald-GI
 *
 * Based on:
 * - EvolveR (arxiv:2510.16079): Self-evolving agents through experience
 * - ALAS (arxiv:2508.15805): Autonomous learning with curriculum
 *
 * Core Loop:
 * 1. Collect user corrections ("I was focused, not scattered")
 * 2. Store experiences with context
 * 3. Distill patterns from accumulated experiences
 * 4. Update prediction rules based on patterns
 * 5. Measure improvement
 * 6. Adjust learning curriculum
 * 7. Repeat
 */

import type { Database } from 'better-sqlite3';

// ============================================
// TYPES
// ============================================

export interface Experience {
  id: string;
  timestamp: Date;
  predictionType: 'attention_state' | 'interest' | 'need' | 'intervention';
  predictedValue: string;
  actualValue: string;
  wasCorrect: boolean;
  context: ExperienceContext;
  userFeedback?: string;
  confidence: number;
}

export interface ExperienceContext {
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  dayOfWeek: number; // 0-6
  activityType?: string;
  tabCount?: number;
  switchFrequency?: number;
  recentTopics?: string[];
  cognitiveLoad?: 'low' | 'medium' | 'high';
  sessionDuration?: number; // minutes
}

export interface Pattern {
  id: string;
  type: 'temporal' | 'contextual' | 'behavioral' | 'sequential';
  description: string;
  conditions: PatternCondition[];
  predictedOutcome: string;
  confidence: number;
  supportCount: number; // number of experiences supporting this
  contradictCount: number; // number of experiences contradicting this
  createdAt: Date;
  lastUpdated: Date;
}

export interface PatternCondition {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'in' | 'contains';
  value: string | number | string[];
}

export interface PredictionRule {
  id: string;
  patternId: string;
  predictionType: string;
  priority: number; // higher = checked first
  isActive: boolean;
  accuracy: number; // 0-1
  usageCount: number;
  lastUsed?: Date;
  createdAt: Date;
}

export interface EvolutionMetrics {
  periodStart: Date;
  periodEnd: Date;
  totalPredictions: number;
  correctPredictions: number;
  accuracy: number;
  improvementRate: number; // compared to previous period
  patternsDiscovered: number;
  rulesUpdated: number;
  rulesDeprecated: number;
}

export interface LearningCurriculum {
  currentPhase: 'exploration' | 'consolidation' | 'refinement';
  explorationRate: number; // 0-1, how much to try new patterns
  confidenceThreshold: number; // min confidence to use a rule
  minSupportCount: number; // min experiences to form a pattern
  evaluationWindow: number; // days to evaluate performance
  lastPhaseChange: Date;
}

// ============================================
// EXPERIENCE STORE
// ============================================

export class ExperienceStore {
  constructor(private db: Database) {}

  /**
   * Record a new experience (prediction + actual outcome)
   */
  record(experience: Omit<Experience, 'id'>): Experience {
    const id = `exp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const exp: Experience = { ...experience, id };

    this.db.prepare(`
      INSERT INTO evolution_experiences (
        id, timestamp, prediction_type, predicted_value, actual_value,
        was_correct, context_json, user_feedback, confidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      exp.id,
      exp.timestamp.toISOString(),
      exp.predictionType,
      exp.predictedValue,
      exp.actualValue,
      exp.wasCorrect ? 1 : 0,
      JSON.stringify(exp.context),
      exp.userFeedback || null,
      exp.confidence
    );

    return exp;
  }

  /**
   * Get experiences for pattern analysis
   */
  getRecent(days: number = 30, type?: string): Experience[] {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    let query = `
      SELECT * FROM evolution_experiences
      WHERE timestamp >= ?
    `;
    const params: (string | number)[] = [cutoff.toISOString()];

    if (type) {
      query += ` AND prediction_type = ?`;
      params.push(type);
    }

    query += ` ORDER BY timestamp DESC`;

    const rows = this.db.prepare(query).all(...params) as any[];

    return rows.map(row => ({
      id: row.id,
      timestamp: new Date(row.timestamp),
      predictionType: row.prediction_type,
      predictedValue: row.predicted_value,
      actualValue: row.actual_value,
      wasCorrect: row.was_correct === 1,
      context: JSON.parse(row.context_json),
      userFeedback: row.user_feedback,
      confidence: row.confidence,
    }));
  }

  /**
   * Get experiences where prediction was wrong (for learning)
   */
  getCorrections(days: number = 30): Experience[] {
    return this.getRecent(days).filter(e => !e.wasCorrect);
  }

  /**
   * Get experience counts by type and outcome
   */
  getStats(days: number = 30): Record<string, { total: number; correct: number; accuracy: number }> {
    const experiences = this.getRecent(days);
    const stats: Record<string, { total: number; correct: number; accuracy: number }> = {};

    for (const exp of experiences) {
      if (!stats[exp.predictionType]) {
        stats[exp.predictionType] = { total: 0, correct: 0, accuracy: 0 };
      }
      stats[exp.predictionType].total++;
      if (exp.wasCorrect) {
        stats[exp.predictionType].correct++;
      }
    }

    for (const type of Object.keys(stats)) {
      stats[type].accuracy = stats[type].total > 0
        ? stats[type].correct / stats[type].total
        : 0;
    }

    return stats;
  }
}

// ============================================
// PATTERN DISTILLER
// ============================================

export class PatternDistiller {
  constructor(private db: Database) {}

  /**
   * Analyze experiences to find patterns
   */
  distill(experiences: Experience[]): Pattern[] {
    const patterns: Pattern[] = [];

    // Group by prediction type
    const byType = this.groupBy(experiences, e => e.predictionType);

    for (const [type, typeExps] of Object.entries(byType)) {
      // Find temporal patterns
      patterns.push(...this.findTemporalPatterns(type, typeExps));

      // Find contextual patterns
      patterns.push(...this.findContextualPatterns(type, typeExps));

      // Find behavioral patterns
      patterns.push(...this.findBehavioralPatterns(type, typeExps));
    }

    return patterns;
  }

  /**
   * Find patterns based on time (morning focused, evening scattered, etc.)
   */
  private findTemporalPatterns(type: string, experiences: Experience[]): Pattern[] {
    const patterns: Pattern[] = [];
    const byTimeOfDay = this.groupBy(experiences, e => e.context.timeOfDay);

    for (const [timeOfDay, exps] of Object.entries(byTimeOfDay)) {
      if (exps.length < 5) continue; // need minimum support

      // Find most common actual value for this time
      const valueCounts = this.countBy(exps, e => e.actualValue);
      const [topValue, count] = this.maxEntry(valueCounts);

      if (count / exps.length >= 0.6) { // 60% threshold
        const contradictCount = exps.filter(e => e.actualValue !== topValue).length;

        patterns.push({
          id: `pattern_temporal_${type}_${timeOfDay}_${Date.now()}`,
          type: 'temporal',
          description: `During ${timeOfDay}, user tends to be ${topValue}`,
          conditions: [
            { field: 'timeOfDay', operator: 'eq', value: timeOfDay }
          ],
          predictedOutcome: topValue,
          confidence: count / exps.length,
          supportCount: count,
          contradictCount,
          createdAt: new Date(),
          lastUpdated: new Date(),
        });
      }
    }

    return patterns;
  }

  /**
   * Find patterns based on context (high tab count = scattered, etc.)
   */
  private findContextualPatterns(type: string, experiences: Experience[]): Pattern[] {
    const patterns: Pattern[] = [];

    // Tab count patterns
    const highTabExps = experiences.filter(e => (e.context.tabCount || 0) > 15);
    if (highTabExps.length >= 5) {
      const valueCounts = this.countBy(highTabExps, e => e.actualValue);
      const [topValue, count] = this.maxEntry(valueCounts);

      if (count / highTabExps.length >= 0.6) {
        patterns.push({
          id: `pattern_context_${type}_hightabs_${Date.now()}`,
          type: 'contextual',
          description: `With many tabs open (>15), user tends to be ${topValue}`,
          conditions: [
            { field: 'tabCount', operator: 'gt', value: 15 }
          ],
          predictedOutcome: topValue,
          confidence: count / highTabExps.length,
          supportCount: count,
          contradictCount: highTabExps.length - count,
          createdAt: new Date(),
          lastUpdated: new Date(),
        });
      }
    }

    // Cognitive load patterns
    const highLoadExps = experiences.filter(e => e.context.cognitiveLoad === 'high');
    if (highLoadExps.length >= 5) {
      const valueCounts = this.countBy(highLoadExps, e => e.actualValue);
      const [topValue, count] = this.maxEntry(valueCounts);

      if (count / highLoadExps.length >= 0.6) {
        patterns.push({
          id: `pattern_context_${type}_highload_${Date.now()}`,
          type: 'contextual',
          description: `Under high cognitive load, user tends to be ${topValue}`,
          conditions: [
            { field: 'cognitiveLoad', operator: 'eq', value: 'high' }
          ],
          predictedOutcome: topValue,
          confidence: count / highLoadExps.length,
          supportCount: count,
          contradictCount: highLoadExps.length - count,
          createdAt: new Date(),
          lastUpdated: new Date(),
        });
      }
    }

    return patterns;
  }

  /**
   * Find patterns based on activity type
   */
  private findBehavioralPatterns(type: string, experiences: Experience[]): Pattern[] {
    const patterns: Pattern[] = [];
    const byActivity = this.groupBy(
      experiences.filter(e => e.context.activityType),
      e => e.context.activityType!
    );

    for (const [activity, exps] of Object.entries(byActivity)) {
      if (exps.length < 5) continue;

      const valueCounts = this.countBy(exps, e => e.actualValue);
      const [topValue, count] = this.maxEntry(valueCounts);

      if (count / exps.length >= 0.6) {
        patterns.push({
          id: `pattern_behavior_${type}_${activity}_${Date.now()}`,
          type: 'behavioral',
          description: `When doing ${activity}, user tends to be ${topValue}`,
          conditions: [
            { field: 'activityType', operator: 'eq', value: activity }
          ],
          predictedOutcome: topValue,
          confidence: count / exps.length,
          supportCount: count,
          contradictCount: exps.length - count,
          createdAt: new Date(),
          lastUpdated: new Date(),
        });
      }
    }

    return patterns;
  }

  /**
   * Save a pattern to the database
   */
  savePattern(pattern: Pattern): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO evolution_patterns (
        id, type, description, conditions_json, predicted_outcome,
        confidence, support_count, contradict_count, created_at, last_updated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      pattern.id,
      pattern.type,
      pattern.description,
      JSON.stringify(pattern.conditions),
      pattern.predictedOutcome,
      pattern.confidence,
      pattern.supportCount,
      pattern.contradictCount,
      pattern.createdAt.toISOString(),
      pattern.lastUpdated.toISOString()
    );
  }

  /**
   * Get all active patterns
   */
  getPatterns(): Pattern[] {
    const rows = this.db.prepare(`
      SELECT * FROM evolution_patterns
      WHERE confidence >= 0.5
      ORDER BY confidence DESC
    `).all() as any[];

    return rows.map(row => ({
      id: row.id,
      type: row.type,
      description: row.description,
      conditions: JSON.parse(row.conditions_json),
      predictedOutcome: row.predicted_outcome,
      confidence: row.confidence,
      supportCount: row.support_count,
      contradictCount: row.contradict_count,
      createdAt: new Date(row.created_at),
      lastUpdated: new Date(row.last_updated),
    }));
  }

  // Utility methods
  private groupBy<T>(arr: T[], fn: (item: T) => string): Record<string, T[]> {
    return arr.reduce((acc, item) => {
      const key = fn(item);
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    }, {} as Record<string, T[]>);
  }

  private countBy<T>(arr: T[], fn: (item: T) => string): Record<string, number> {
    return arr.reduce((acc, item) => {
      const key = fn(item);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }

  private maxEntry(counts: Record<string, number>): [string, number] {
    let maxKey = '';
    let maxVal = 0;
    for (const [key, val] of Object.entries(counts)) {
      if (val > maxVal) {
        maxKey = key;
        maxVal = val;
      }
    }
    return [maxKey, maxVal];
  }
}

// ============================================
// RULE UPDATER
// ============================================

export class RuleUpdater {
  constructor(private db: Database) {}

  /**
   * Create or update rules based on patterns
   */
  updateRules(patterns: Pattern[]): { created: number; updated: number; deprecated: number } {
    let created = 0;
    let updated = 0;
    let deprecated = 0;

    for (const pattern of patterns) {
      const existing = this.getRuleByPattern(pattern.id);

      if (existing) {
        // Update existing rule
        this.db.prepare(`
          UPDATE evolution_rules
          SET accuracy = ?, priority = ?, is_active = ?
          WHERE id = ?
        `).run(
          pattern.confidence,
          Math.round(pattern.confidence * 100),
          pattern.confidence >= 0.5 ? 1 : 0,
          existing.id
        );
        updated++;

        if (pattern.confidence < 0.5) {
          deprecated++;
        }
      } else if (pattern.confidence >= 0.5) {
        // Create new rule
        const id = `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.db.prepare(`
          INSERT INTO evolution_rules (
            id, pattern_id, prediction_type, priority, is_active,
            accuracy, usage_count, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          pattern.id,
          this.inferPredictionType(pattern),
          Math.round(pattern.confidence * 100),
          1,
          pattern.confidence,
          0,
          new Date().toISOString()
        );
        created++;
      }
    }

    return { created, updated, deprecated };
  }

  /**
   * Get rule for a pattern
   */
  private getRuleByPattern(patternId: string): PredictionRule | null {
    const row = this.db.prepare(`
      SELECT * FROM evolution_rules WHERE pattern_id = ?
    `).get(patternId) as any;

    if (!row) return null;

    return {
      id: row.id,
      patternId: row.pattern_id,
      predictionType: row.prediction_type,
      priority: row.priority,
      isActive: row.is_active === 1,
      accuracy: row.accuracy,
      usageCount: row.usage_count,
      lastUsed: row.last_used ? new Date(row.last_used) : undefined,
      createdAt: new Date(row.created_at),
    };
  }

  /**
   * Get all active rules sorted by priority
   */
  getActiveRules(): PredictionRule[] {
    const rows = this.db.prepare(`
      SELECT * FROM evolution_rules
      WHERE is_active = 1
      ORDER BY priority DESC
    `).all() as any[];

    return rows.map(row => ({
      id: row.id,
      patternId: row.pattern_id,
      predictionType: row.prediction_type,
      priority: row.priority,
      isActive: true,
      accuracy: row.accuracy,
      usageCount: row.usage_count,
      lastUsed: row.last_used ? new Date(row.last_used) : undefined,
      createdAt: new Date(row.created_at),
    }));
  }

  /**
   * Record rule usage
   */
  recordUsage(ruleId: string): void {
    this.db.prepare(`
      UPDATE evolution_rules
      SET usage_count = usage_count + 1, last_used = ?
      WHERE id = ?
    `).run(new Date().toISOString(), ruleId);
  }

  private inferPredictionType(pattern: Pattern): string {
    // Infer from pattern description
    if (pattern.description.includes('focused') || pattern.description.includes('scattered')) {
      return 'attention_state';
    }
    if (pattern.description.includes('interested') || pattern.description.includes('topic')) {
      return 'interest';
    }
    return 'general';
  }
}

// ============================================
// EVOLUTION MEASURER
// ============================================

export class EvolutionMeasurer {
  constructor(private db: Database) {}

  /**
   * Calculate evolution metrics for a period
   */
  measure(periodDays: number = 7): EvolutionMetrics {
    const now = new Date();
    const periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - periodDays);

    // Get current period stats
    const currentExps = this.getExperiencesInPeriod(periodStart, now);
    const correctCount = currentExps.filter(e => e.wasCorrect).length;
    const currentAccuracy = currentExps.length > 0 ? correctCount / currentExps.length : 0;

    // Get previous period stats for comparison
    const prevPeriodStart = new Date(periodStart);
    prevPeriodStart.setDate(prevPeriodStart.getDate() - periodDays);
    const prevExps = this.getExperiencesInPeriod(prevPeriodStart, periodStart);
    const prevCorrect = prevExps.filter(e => e.wasCorrect).length;
    const prevAccuracy = prevExps.length > 0 ? prevCorrect / prevExps.length : 0;

    // Calculate improvement rate
    const improvementRate = prevAccuracy > 0
      ? (currentAccuracy - prevAccuracy) / prevAccuracy
      : 0;

    // Count patterns and rules changes
    const patternsDiscovered = this.countNewPatterns(periodStart, now);
    const { rulesUpdated, rulesDeprecated } = this.countRuleChanges(periodStart, now);

    return {
      periodStart,
      periodEnd: now,
      totalPredictions: currentExps.length,
      correctPredictions: correctCount,
      accuracy: currentAccuracy,
      improvementRate,
      patternsDiscovered,
      rulesUpdated,
      rulesDeprecated,
    };
  }

  private getExperiencesInPeriod(start: Date, end: Date): Experience[] {
    const rows = this.db.prepare(`
      SELECT * FROM evolution_experiences
      WHERE timestamp >= ? AND timestamp <= ?
    `).all(start.toISOString(), end.toISOString()) as any[];

    return rows.map(row => ({
      id: row.id,
      timestamp: new Date(row.timestamp),
      predictionType: row.prediction_type,
      predictedValue: row.predicted_value,
      actualValue: row.actual_value,
      wasCorrect: row.was_correct === 1,
      context: JSON.parse(row.context_json),
      userFeedback: row.user_feedback,
      confidence: row.confidence,
    }));
  }

  private countNewPatterns(start: Date, end: Date): number {
    const result = this.db.prepare(`
      SELECT COUNT(*) as count FROM evolution_patterns
      WHERE created_at >= ? AND created_at < ?
    `).get(start.toISOString(), end.toISOString()) as any;
    return result?.count || 0;
  }

  private countRuleChanges(start: Date, end: Date): { rulesUpdated: number; rulesDeprecated: number } {
    // This is a simplification - in production we'd track rule history
    const activeRules = this.db.prepare(`
      SELECT COUNT(*) as count FROM evolution_rules WHERE is_active = 1
    `).get() as any;

    const inactiveRules = this.db.prepare(`
      SELECT COUNT(*) as count FROM evolution_rules WHERE is_active = 0
    `).get() as any;

    return {
      rulesUpdated: activeRules?.count || 0,
      rulesDeprecated: inactiveRules?.count || 0,
    };
  }

  /**
   * Check if system is improving
   */
  isImproving(windowDays: number = 14): boolean {
    const metrics = this.measure(windowDays);
    return metrics.improvementRate > 0;
  }

  /**
   * Get improvement trend over multiple periods
   */
  getTrend(periods: number = 4, periodDays: number = 7): number[] {
    const accuracies: number[] = [];
    const now = new Date();

    for (let i = 0; i < periods; i++) {
      const end = new Date(now);
      end.setDate(end.getDate() - (i * periodDays));
      const start = new Date(end);
      start.setDate(start.getDate() - periodDays);

      const exps = this.getExperiencesInPeriod(start, end);
      const accuracy = exps.length > 0
        ? exps.filter(e => e.wasCorrect).length / exps.length
        : 0;
      accuracies.unshift(accuracy); // oldest first
    }

    return accuracies;
  }
}

// ============================================
// CURRICULUM MANAGER
// ============================================

export class CurriculumManager {
  private curriculum: LearningCurriculum;

  constructor(private db: Database) {
    this.curriculum = this.loadCurriculum();
  }

  private loadCurriculum(): LearningCurriculum {
    const row = this.db.prepare(`
      SELECT * FROM evolution_curriculum LIMIT 1
    `).get() as any;

    if (row) {
      return {
        currentPhase: row.current_phase,
        explorationRate: row.exploration_rate,
        confidenceThreshold: row.confidence_threshold,
        minSupportCount: row.min_support_count,
        evaluationWindow: row.evaluation_window,
        lastPhaseChange: new Date(row.last_phase_change),
      };
    }

    // Default curriculum
    const defaultCurriculum: LearningCurriculum = {
      currentPhase: 'exploration',
      explorationRate: 0.3,
      confidenceThreshold: 0.5,
      minSupportCount: 5,
      evaluationWindow: 7,
      lastPhaseChange: new Date(),
    };

    this.saveCurriculum(defaultCurriculum);
    return defaultCurriculum;
  }

  private saveCurriculum(curriculum: LearningCurriculum): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO evolution_curriculum (
        id, current_phase, exploration_rate, confidence_threshold,
        min_support_count, evaluation_window, last_phase_change
      ) VALUES (1, ?, ?, ?, ?, ?, ?)
    `).run(
      curriculum.currentPhase,
      curriculum.explorationRate,
      curriculum.confidenceThreshold,
      curriculum.minSupportCount,
      curriculum.evaluationWindow,
      curriculum.lastPhaseChange.toISOString()
    );
  }

  /**
   * Get current curriculum settings
   */
  getCurriculum(): LearningCurriculum {
    return { ...this.curriculum };
  }

  /**
   * Adjust curriculum based on performance
   */
  adjust(metrics: EvolutionMetrics): LearningCurriculum {
    const daysSinceChange = Math.floor(
      (Date.now() - this.curriculum.lastPhaseChange.getTime()) / (1000 * 60 * 60 * 24)
    );

    // Only consider phase change after evaluation window
    if (daysSinceChange < this.curriculum.evaluationWindow) {
      return this.curriculum;
    }

    const newCurriculum = { ...this.curriculum };

    if (this.curriculum.currentPhase === 'exploration') {
      // Move to consolidation when we have enough good patterns
      if (metrics.accuracy >= 0.6 && metrics.patternsDiscovered >= 5) {
        newCurriculum.currentPhase = 'consolidation';
        newCurriculum.explorationRate = 0.15;
        newCurriculum.confidenceThreshold = 0.6;
        newCurriculum.lastPhaseChange = new Date();
      }
    } else if (this.curriculum.currentPhase === 'consolidation') {
      if (metrics.accuracy >= 0.75 && metrics.improvementRate >= 0) {
        // Move to refinement when stable and accurate
        newCurriculum.currentPhase = 'refinement';
        newCurriculum.explorationRate = 0.05;
        newCurriculum.confidenceThreshold = 0.7;
        newCurriculum.lastPhaseChange = new Date();
      } else if (metrics.accuracy < 0.5 || metrics.improvementRate < -0.1) {
        // Fall back to exploration if things go wrong
        newCurriculum.currentPhase = 'exploration';
        newCurriculum.explorationRate = 0.4;
        newCurriculum.confidenceThreshold = 0.4;
        newCurriculum.lastPhaseChange = new Date();
      }
    } else if (this.curriculum.currentPhase === 'refinement') {
      if (metrics.accuracy < 0.6 || metrics.improvementRate < -0.15) {
        // Something changed - go back to consolidation
        newCurriculum.currentPhase = 'consolidation';
        newCurriculum.explorationRate = 0.2;
        newCurriculum.confidenceThreshold = 0.55;
        newCurriculum.lastPhaseChange = new Date();
      }
    }

    if (newCurriculum.currentPhase !== this.curriculum.currentPhase) {
      this.saveCurriculum(newCurriculum);
      this.curriculum = newCurriculum;
    }

    return newCurriculum;
  }

  /**
   * Should we try a new pattern (exploration) or stick to known rules?
   */
  shouldExplore(): boolean {
    return Math.random() < this.curriculum.explorationRate;
  }
}

// ============================================
// SELF-EVOLUTION ORCHESTRATOR
// ============================================

export class SelfEvolutionLoop {
  private experienceStore: ExperienceStore;
  private patternDistiller: PatternDistiller;
  private ruleUpdater: RuleUpdater;
  private measurer: EvolutionMeasurer;
  private curriculum: CurriculumManager;

  constructor(private db: Database) {
    this.experienceStore = new ExperienceStore(db);
    this.patternDistiller = new PatternDistiller(db);
    this.ruleUpdater = new RuleUpdater(db);
    this.measurer = new EvolutionMeasurer(db);
    this.curriculum = new CurriculumManager(db);
  }

  /**
   * Record a user correction
   */
  recordCorrection(
    predictionType: Experience['predictionType'],
    predictedValue: string,
    actualValue: string,
    context: ExperienceContext,
    userFeedback?: string
  ): Experience {
    return this.experienceStore.record({
      timestamp: new Date(),
      predictionType,
      predictedValue,
      actualValue,
      wasCorrect: predictedValue === actualValue,
      context,
      userFeedback,
      confidence: 1.0, // user provided, so full confidence
    });
  }

  /**
   * Record a prediction outcome (automatic, not user-corrected)
   */
  recordPrediction(
    predictionType: Experience['predictionType'],
    predictedValue: string,
    actualValue: string,
    context: ExperienceContext,
    confidence: number
  ): Experience {
    return this.experienceStore.record({
      timestamp: new Date(),
      predictionType,
      predictedValue,
      actualValue,
      wasCorrect: predictedValue === actualValue,
      context,
      confidence,
    });
  }

  /**
   * Run the evolution loop (should be called periodically)
   */
  evolve(): {
    metrics: EvolutionMetrics;
    patterns: Pattern[];
    ruleChanges: { created: number; updated: number; deprecated: number };
    curriculum: LearningCurriculum;
  } {
    // 1. Measure current performance
    const metrics = this.measurer.measure();

    // 2. Get recent experiences
    const experiences = this.experienceStore.getRecent(30);

    // 3. Distill patterns from experiences
    const patterns = this.patternDistiller.distill(experiences);

    // 4. Save patterns
    for (const pattern of patterns) {
      this.patternDistiller.savePattern(pattern);
    }

    // 5. Update rules based on patterns
    const ruleChanges = this.ruleUpdater.updateRules(patterns);

    // 6. Adjust curriculum based on performance
    const curriculum = this.curriculum.adjust(metrics);

    return { metrics, patterns, ruleChanges, curriculum };
  }

  /**
   * Get a prediction using learned rules
   */
  predict(
    predictionType: string,
    context: ExperienceContext
  ): { value: string; confidence: number; ruleId?: string } | null {
    const rules = this.ruleUpdater.getActiveRules()
      .filter(r => r.predictionType === predictionType || r.predictionType === 'general');

    if (rules.length === 0) return null;

    // Get patterns for rules
    const patterns = this.patternDistiller.getPatterns();
    const patternMap = new Map(patterns.map(p => [p.id, p]));

    // Find matching rule
    for (const rule of rules) {
      const pattern = patternMap.get(rule.patternId);
      if (!pattern) continue;

      if (this.matchesConditions(pattern.conditions, context)) {
        this.ruleUpdater.recordUsage(rule.id);
        return {
          value: pattern.predictedOutcome,
          confidence: rule.accuracy,
          ruleId: rule.id,
        };
      }
    }

    return null;
  }

  private matchesConditions(conditions: PatternCondition[], context: ExperienceContext): boolean {
    for (const cond of conditions) {
      const value = (context as any)[cond.field];
      if (value === undefined) return false;

      switch (cond.operator) {
        case 'eq':
          if (value !== cond.value) return false;
          break;
        case 'neq':
          if (value === cond.value) return false;
          break;
        case 'gt':
          if (typeof value !== 'number' || value <= (cond.value as number)) return false;
          break;
        case 'lt':
          if (typeof value !== 'number' || value >= (cond.value as number)) return false;
          break;
        case 'gte':
          if (typeof value !== 'number' || value < (cond.value as number)) return false;
          break;
        case 'lte':
          if (typeof value !== 'number' || value > (cond.value as number)) return false;
          break;
        case 'in':
          if (!Array.isArray(cond.value) || !cond.value.includes(value)) return false;
          break;
        case 'contains':
          if (typeof value !== 'string' || !value.includes(cond.value as string)) return false;
          break;
      }
    }
    return true;
  }

  /**
   * Get evolution status summary
   */
  getStatus(): {
    isImproving: boolean;
    currentPhase: string;
    accuracy: number;
    trend: number[];
    experienceCount: number;
    patternCount: number;
    ruleCount: number;
  } {
    const metrics = this.measurer.measure();
    const trend = this.measurer.getTrend();
    const curriculum = this.curriculum.getCurriculum();
    const experiences = this.experienceStore.getRecent(30);
    const patterns = this.patternDistiller.getPatterns();
    const rules = this.ruleUpdater.getActiveRules();

    return {
      isImproving: this.measurer.isImproving(),
      currentPhase: curriculum.currentPhase,
      accuracy: metrics.accuracy,
      trend,
      experienceCount: experiences.length,
      patternCount: patterns.length,
      ruleCount: rules.length,
    };
  }

  /**
   * Should we use learned rules or fall back to default behavior?
   */
  shouldUseLearnedRules(): boolean {
    const curriculum = this.curriculum.getCurriculum();
    const metrics = this.measurer.measure();

    // Use learned rules if we have good enough accuracy
    return metrics.accuracy >= curriculum.confidenceThreshold;
  }
}

// ============================================
// EXPORTS
// ============================================

export default {
  ExperienceStore,
  PatternDistiller,
  RuleUpdater,
  EvolutionMeasurer,
  CurriculumManager,
  SelfEvolutionLoop,
};
