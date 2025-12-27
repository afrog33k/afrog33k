/**
 * Tests for Self-Evolution Loop
 *
 * Testing the EvolveR/ALAS-inspired learning system:
 * - Experience storage and retrieval
 * - Pattern distillation from experiences
 * - Rule creation and updates
 * - Evolution measurement
 * - Curriculum management
 * - Full evolution loop
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  getTestDb,
  resetTestDb,
  closeTestDb,
  createTestExperience,
  createTemporalPattern,
  createContextualPattern,
  createMixedExperiences,
  createTestPattern,
  createTestRule,
} from './setup';
import {
  ExperienceStore,
  PatternDistiller,
  RuleUpdater,
  EvolutionMeasurer,
  CurriculumManager,
  SelfEvolutionLoop,
  type Experience,
  type ExperienceContext,
  type Pattern,
} from '../lib/self_evolution';

describe('Self-Evolution Loop', () => {
  beforeEach(() => {
    resetTestDb();
  });

  afterAll(() => {
    closeTestDb();
  });

  // ============================================
  // EXPERIENCE STORE TESTS
  // ============================================

  describe('ExperienceStore', () => {
    it('should record a new experience', () => {
      const db = getTestDb();
      const store = new ExperienceStore(db);

      const exp = store.record({
        timestamp: new Date(),
        predictionType: 'attention_state',
        predictedValue: 'focused',
        actualValue: 'scattered',
        wasCorrect: false,
        context: {
          timeOfDay: 'morning',
          dayOfWeek: 1,
          tabCount: 12,
        },
        userFeedback: 'I was actually scattered',
        confidence: 1.0,
      });

      expect(exp.id).toBeDefined();
      expect(exp.wasCorrect).toBe(false);
    });

    it('should retrieve recent experiences', () => {
      const db = getTestDb();
      const store = new ExperienceStore(db);

      // Create experiences at different times
      for (let i = 0; i < 5; i++) {
        createTestExperience(db, {
          predictionType: 'attention_state',
          predictedValue: 'focused',
          actualValue: 'focused',
          context: { timeOfDay: 'morning', dayOfWeek: i % 7 },
          daysAgo: i * 5,
        });
      }

      const recent = store.getRecent(15);
      expect(recent.length).toBeGreaterThanOrEqual(3); // Within 15 days
    });

    it('should get only corrections (wrong predictions)', () => {
      const db = getTestDb();
      const store = new ExperienceStore(db);

      // Create mix of correct and incorrect
      createTestExperience(db, {
        predictionType: 'attention_state',
        predictedValue: 'focused',
        actualValue: 'focused', // correct
        context: { timeOfDay: 'morning', dayOfWeek: 1 },
      });

      createTestExperience(db, {
        predictionType: 'attention_state',
        predictedValue: 'focused',
        actualValue: 'scattered', // wrong
        context: { timeOfDay: 'afternoon', dayOfWeek: 2 },
      });

      const corrections = store.getCorrections(30);
      expect(corrections.length).toBe(1);
      expect(corrections[0].actualValue).toBe('scattered');
    });

    it('should calculate stats by prediction type', () => {
      const db = getTestDb();
      const store = new ExperienceStore(db);

      // Create experiences
      createTestExperience(db, {
        predictionType: 'attention_state',
        predictedValue: 'focused',
        actualValue: 'focused',
        context: { timeOfDay: 'morning', dayOfWeek: 1 },
      });

      createTestExperience(db, {
        predictionType: 'attention_state',
        predictedValue: 'focused',
        actualValue: 'scattered',
        context: { timeOfDay: 'afternoon', dayOfWeek: 2 },
      });

      const stats = store.getStats(30);
      expect(stats['attention_state']).toBeDefined();
      expect(stats['attention_state'].total).toBe(2);
      expect(stats['attention_state'].correct).toBe(1);
      expect(stats['attention_state'].accuracy).toBe(0.5);
    });
  });

  // ============================================
  // PATTERN DISTILLER TESTS
  // ============================================

  describe('PatternDistiller', () => {
    it('should find temporal patterns', () => {
      const db = getTestDb();
      const distiller = new PatternDistiller(db);
      const store = new ExperienceStore(db);

      // Create morning pattern: user is focused in the morning
      createTemporalPattern(db, 'morning', 'focused', 10);

      const experiences = store.getRecent(30);
      const patterns = distiller.distill(experiences);

      const morningPattern = patterns.find(
        p => p.type === 'temporal' && p.description.includes('morning')
      );

      expect(morningPattern).toBeDefined();
      expect(morningPattern?.predictedOutcome).toBe('focused');
      expect(morningPattern?.confidence).toBeGreaterThanOrEqual(0.6);
    });

    it('should find contextual patterns (high tab count)', () => {
      const db = getTestDb();
      const distiller = new PatternDistiller(db);
      const store = new ExperienceStore(db);

      // Create high tab count pattern: user scattered with many tabs
      createContextualPattern(db, { tabCount: 20 }, 'scattered', 10);

      const experiences = store.getRecent(30);
      const patterns = distiller.distill(experiences);

      const tabPattern = patterns.find(
        p => p.type === 'contextual' && p.description.includes('tabs')
      );

      expect(tabPattern).toBeDefined();
      expect(tabPattern?.predictedOutcome).toBe('scattered');
    });

    it('should find behavioral patterns (activity type)', () => {
      const db = getTestDb();
      const distiller = new PatternDistiller(db);
      const store = new ExperienceStore(db);

      // Create activity pattern: user focused when coding
      for (let i = 0; i < 10; i++) {
        createTestExperience(db, {
          predictionType: 'attention_state',
          predictedValue: 'focused',
          actualValue: 'focused',
          context: {
            timeOfDay: 'afternoon',
            dayOfWeek: i % 7,
            activityType: 'coding',
          },
          daysAgo: i,
        });
      }

      const experiences = store.getRecent(30);
      const patterns = distiller.distill(experiences);

      const codingPattern = patterns.find(
        p => p.type === 'behavioral' && p.description.includes('coding')
      );

      expect(codingPattern).toBeDefined();
      expect(codingPattern?.predictedOutcome).toBe('focused');
    });

    it('should save and retrieve patterns', () => {
      const db = getTestDb();
      const distiller = new PatternDistiller(db);

      const pattern: Pattern = {
        id: 'test_pattern_1',
        type: 'temporal',
        description: 'Morning focus pattern',
        conditions: [{ field: 'timeOfDay', operator: 'eq', value: 'morning' }],
        predictedOutcome: 'focused',
        confidence: 0.8,
        supportCount: 10,
        contradictCount: 2,
        createdAt: new Date(),
        lastUpdated: new Date(),
      };

      distiller.savePattern(pattern);
      const patterns = distiller.getPatterns();

      expect(patterns.length).toBe(1);
      expect(patterns[0].id).toBe('test_pattern_1');
    });

    it('should require minimum support count for patterns', () => {
      const db = getTestDb();
      const distiller = new PatternDistiller(db);
      const store = new ExperienceStore(db);

      // Create only 2 experiences (not enough for pattern)
      createTestExperience(db, {
        predictionType: 'attention_state',
        predictedValue: 'focused',
        actualValue: 'focused',
        context: { timeOfDay: 'morning', dayOfWeek: 1 },
      });

      createTestExperience(db, {
        predictionType: 'attention_state',
        predictedValue: 'focused',
        actualValue: 'focused',
        context: { timeOfDay: 'morning', dayOfWeek: 2 },
      });

      const experiences = store.getRecent(30);
      const patterns = distiller.distill(experiences);

      // Should not find patterns with only 2 experiences
      const morningPattern = patterns.find(
        p => p.type === 'temporal' && p.description.includes('morning')
      );
      expect(morningPattern).toBeUndefined();
    });
  });

  // ============================================
  // RULE UPDATER TESTS
  // ============================================

  describe('RuleUpdater', () => {
    it('should create rules from patterns', () => {
      const db = getTestDb();
      const updater = new RuleUpdater(db);
      const distiller = new PatternDistiller(db);

      // Create a pattern
      const pattern: Pattern = {
        id: 'pattern_for_rule',
        type: 'temporal',
        description: 'Morning focus',
        conditions: [{ field: 'timeOfDay', operator: 'eq', value: 'morning' }],
        predictedOutcome: 'focused',
        confidence: 0.75,
        supportCount: 10,
        contradictCount: 3,
        createdAt: new Date(),
        lastUpdated: new Date(),
      };

      distiller.savePattern(pattern);
      const result = updater.updateRules([pattern]);

      expect(result.created).toBe(1);
      expect(result.updated).toBe(0);

      const rules = updater.getActiveRules();
      expect(rules.length).toBe(1);
      expect(rules[0].accuracy).toBe(0.75);
    });

    it('should update existing rules when patterns change', () => {
      const db = getTestDb();
      const updater = new RuleUpdater(db);
      const distiller = new PatternDistiller(db);

      // Create initial pattern
      const pattern: Pattern = {
        id: 'evolving_pattern',
        type: 'temporal',
        description: 'Morning focus',
        conditions: [{ field: 'timeOfDay', operator: 'eq', value: 'morning' }],
        predictedOutcome: 'focused',
        confidence: 0.7,
        supportCount: 10,
        contradictCount: 4,
        createdAt: new Date(),
        lastUpdated: new Date(),
      };

      distiller.savePattern(pattern);
      updater.updateRules([pattern]);

      // Update pattern with higher confidence
      pattern.confidence = 0.85;
      pattern.supportCount = 20;
      distiller.savePattern(pattern);
      const result = updater.updateRules([pattern]);

      expect(result.updated).toBe(1);

      const rules = updater.getActiveRules();
      expect(rules[0].accuracy).toBe(0.85);
    });

    it('should deprecate rules with low confidence', () => {
      const db = getTestDb();
      const updater = new RuleUpdater(db);
      const distiller = new PatternDistiller(db);

      // Create pattern that becomes unreliable
      const pattern: Pattern = {
        id: 'failing_pattern',
        type: 'temporal',
        description: 'Evening focus',
        conditions: [{ field: 'timeOfDay', operator: 'eq', value: 'evening' }],
        predictedOutcome: 'focused',
        confidence: 0.6,
        supportCount: 10,
        contradictCount: 7,
        createdAt: new Date(),
        lastUpdated: new Date(),
      };

      distiller.savePattern(pattern);
      updater.updateRules([pattern]);

      // Pattern confidence drops
      pattern.confidence = 0.3;
      pattern.contradictCount = 15;
      distiller.savePattern(pattern);
      const result = updater.updateRules([pattern]);

      expect(result.deprecated).toBe(1);

      const activeRules = updater.getActiveRules();
      expect(activeRules.length).toBe(0);
    });

    it('should record rule usage', () => {
      const db = getTestDb();
      const ruleId = createTestRule(db, { usageCount: 0 });
      const updater = new RuleUpdater(db);

      updater.recordUsage(ruleId);
      updater.recordUsage(ruleId);

      const rules = updater.getActiveRules();
      const rule = rules.find(r => r.id === ruleId);
      expect(rule?.usageCount).toBe(2);
      expect(rule?.lastUsed).toBeDefined();
    });
  });

  // ============================================
  // EVOLUTION MEASURER TESTS
  // ============================================

  describe('EvolutionMeasurer', () => {
    it('should calculate accuracy for a period', () => {
      const db = getTestDb();
      const measurer = new EvolutionMeasurer(db);

      // Create 80% accurate experiences (all within window)
      for (let i = 0; i < 10; i++) {
        createTestExperience(db, {
          predictionType: 'attention_state',
          predictedValue: 'focused',
          actualValue: i < 8 ? 'focused' : 'scattered',
          context: { timeOfDay: 'morning', dayOfWeek: i % 7 },
          daysAgo: 0, // All today to ensure they're in the 7-day window
        });
      }

      const metrics = measurer.measure(7);
      expect(metrics.accuracy).toBe(0.8);
      expect(metrics.totalPredictions).toBe(10);
      expect(metrics.correctPredictions).toBe(8);
    });

    it('should calculate improvement rate', () => {
      const db = getTestDb();
      const measurer = new EvolutionMeasurer(db);

      // Create previous period (50% accurate)
      for (let i = 0; i < 10; i++) {
        createTestExperience(db, {
          predictionType: 'attention_state',
          predictedValue: 'focused',
          actualValue: i < 5 ? 'focused' : 'scattered',
          context: { timeOfDay: 'morning', dayOfWeek: i % 7 },
          daysAgo: 10 + i, // Previous period
        });
      }

      // Create current period (80% accurate)
      for (let i = 0; i < 10; i++) {
        createTestExperience(db, {
          predictionType: 'attention_state',
          predictedValue: 'focused',
          actualValue: i < 8 ? 'focused' : 'scattered',
          context: { timeOfDay: 'morning', dayOfWeek: i % 7 },
          daysAgo: i, // Current period
        });
      }

      const metrics = measurer.measure(7);
      expect(metrics.improvementRate).toBeGreaterThan(0);
    });

    it('should detect if system is improving', () => {
      const db = getTestDb();
      const measurer = new EvolutionMeasurer(db);

      // Create improving pattern
      for (let i = 0; i < 20; i++) {
        const wasCorrect = i > 10; // First half wrong, second half right
        createTestExperience(db, {
          predictionType: 'attention_state',
          predictedValue: 'focused',
          actualValue: wasCorrect ? 'focused' : 'scattered',
          context: { timeOfDay: 'morning', dayOfWeek: i % 7 },
          daysAgo: 20 - i,
        });
      }

      const isImproving = measurer.isImproving(14);
      expect(typeof isImproving).toBe('boolean');
    });

    it('should get accuracy trend over periods', () => {
      const db = getTestDb();
      const measurer = new EvolutionMeasurer(db);

      // Create experiences across 4 weeks
      for (let i = 0; i < 28; i++) {
        const weekAccuracy = Math.floor(i / 7) * 0.2 + 0.4; // 40% → 60% → 80% → 100%
        const wasCorrect = Math.random() < weekAccuracy;
        createTestExperience(db, {
          predictionType: 'attention_state',
          predictedValue: 'focused',
          actualValue: wasCorrect ? 'focused' : 'scattered',
          context: { timeOfDay: 'morning', dayOfWeek: i % 7 },
          daysAgo: 28 - i,
        });
      }

      const trend = measurer.getTrend(4, 7);
      expect(trend.length).toBe(4);
    });
  });

  // ============================================
  // CURRICULUM MANAGER TESTS
  // ============================================

  describe('CurriculumManager', () => {
    it('should initialize with exploration phase', () => {
      const db = getTestDb();
      const curriculum = new CurriculumManager(db);

      const state = curriculum.getCurriculum();
      expect(state.currentPhase).toBe('exploration');
      expect(state.explorationRate).toBeGreaterThan(0);
    });

    it('should transition from exploration to consolidation', () => {
      const db = getTestDb();
      const curriculum = new CurriculumManager(db);

      // Simulate good metrics after exploration window
      const initial = curriculum.getCurriculum();

      // Manually set lastPhaseChange to past
      db.prepare(`
        UPDATE evolution_curriculum SET last_phase_change = ?
      `).run(new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString());

      const metrics = {
        periodStart: new Date(),
        periodEnd: new Date(),
        totalPredictions: 100,
        correctPredictions: 65,
        accuracy: 0.65,
        improvementRate: 0.1,
        patternsDiscovered: 6,
        rulesUpdated: 5,
        rulesDeprecated: 1,
      };

      const updated = curriculum.adjust(metrics);
      expect(updated.currentPhase).toBe('consolidation');
      expect(updated.explorationRate).toBeLessThan(initial.explorationRate);
    });

    it('should fall back to exploration on degradation', () => {
      const db = getTestDb();
      const curriculum = new CurriculumManager(db);

      // Set to consolidation phase
      db.prepare(`
        UPDATE evolution_curriculum
        SET current_phase = 'consolidation', last_phase_change = ?
      `).run(new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString());

      // Bad metrics
      const metrics = {
        periodStart: new Date(),
        periodEnd: new Date(),
        totalPredictions: 100,
        correctPredictions: 30,
        accuracy: 0.3,
        improvementRate: -0.2,
        patternsDiscovered: 0,
        rulesUpdated: 0,
        rulesDeprecated: 5,
      };

      const updated = curriculum.adjust(metrics);
      expect(updated.currentPhase).toBe('exploration');
    });

    it('should make exploration decisions', () => {
      const db = getTestDb();
      const curriculum = new CurriculumManager(db);

      // Run multiple times to test randomness
      let exploreCount = 0;
      for (let i = 0; i < 100; i++) {
        if (curriculum.shouldExplore()) exploreCount++;
      }

      // With default 0.3 exploration rate, should be around 30
      expect(exploreCount).toBeGreaterThan(10);
      expect(exploreCount).toBeLessThan(60);
    });
  });

  // ============================================
  // SELF-EVOLUTION LOOP TESTS (INTEGRATION)
  // ============================================

  describe('SelfEvolutionLoop', () => {
    it('should record user corrections', () => {
      const db = getTestDb();
      const loop = new SelfEvolutionLoop(db);

      const exp = loop.recordCorrection(
        'attention_state',
        'focused',
        'scattered',
        { timeOfDay: 'afternoon', dayOfWeek: 2, tabCount: 15 },
        'I was actually scattered'
      );

      expect(exp.wasCorrect).toBe(false);
      expect(exp.userFeedback).toBe('I was actually scattered');
    });

    it('should run full evolution cycle', () => {
      const db = getTestDb();
      const loop = new SelfEvolutionLoop(db);

      // Create training data
      createTemporalPattern(db, 'morning', 'focused', 10);
      createContextualPattern(db, { tabCount: 20 }, 'scattered', 10);

      const result = loop.evolve();

      expect(result.metrics).toBeDefined();
      expect(result.patterns.length).toBeGreaterThan(0);
      expect(result.curriculum).toBeDefined();
    });

    it('should make predictions using learned rules', () => {
      const db = getTestDb();
      const loop = new SelfEvolutionLoop(db);

      // Create pattern and rule
      const patternId = createTestPattern(db, {
        type: 'temporal',
        conditions: [{ field: 'timeOfDay', operator: 'eq', value: 'morning' }],
        predictedOutcome: 'focused',
        confidence: 0.85,
      });

      createTestRule(db, {
        patternId,
        predictionType: 'attention_state',
        accuracy: 0.85,
      });

      const prediction = loop.predict('attention_state', {
        timeOfDay: 'morning',
        dayOfWeek: 1,
      });

      expect(prediction).toBeDefined();
      expect(prediction?.value).toBe('focused');
      expect(prediction?.confidence).toBe(0.85);
    });

    it('should return null when no matching rules', () => {
      const db = getTestDb();
      const loop = new SelfEvolutionLoop(db);

      const prediction = loop.predict('attention_state', {
        timeOfDay: 'night',
        dayOfWeek: 1,
      });

      expect(prediction).toBeNull();
    });

    it('should get evolution status', () => {
      const db = getTestDb();
      const loop = new SelfEvolutionLoop(db);

      // Create some data
      createMixedExperiences(db, 0.7, 20);
      createTestPattern(db);
      createTestRule(db);

      const status = loop.getStatus();

      expect(status.currentPhase).toBeDefined();
      expect(typeof status.accuracy).toBe('number');
      expect(Array.isArray(status.trend)).toBe(true);
      expect(status.experienceCount).toBeGreaterThan(0);
    });

    it('should decide whether to use learned rules', () => {
      const db = getTestDb();
      const loop = new SelfEvolutionLoop(db);

      // Low accuracy - should not use learned rules
      createMixedExperiences(db, 0.3, 20);
      expect(loop.shouldUseLearnedRules()).toBe(false);
    });

    it('should handle multiple prediction types', () => {
      const db = getTestDb();
      const loop = new SelfEvolutionLoop(db);

      // Create patterns for different types
      const attentionPatternId = createTestPattern(db, {
        id: 'attention_pattern',
        type: 'temporal',
        conditions: [{ field: 'timeOfDay', operator: 'eq', value: 'morning' }],
        predictedOutcome: 'focused',
      });

      createTestRule(db, {
        patternId: attentionPatternId,
        predictionType: 'attention_state',
      });

      const interestPatternId = createTestPattern(db, {
        id: 'interest_pattern',
        type: 'behavioral',
        conditions: [{ field: 'activityType', operator: 'eq', value: 'coding' }],
        predictedOutcome: 'high',
      });

      createTestRule(db, {
        patternId: interestPatternId,
        predictionType: 'interest',
      });

      // Query attention
      const attention = loop.predict('attention_state', {
        timeOfDay: 'morning',
        dayOfWeek: 1,
      });
      expect(attention?.value).toBe('focused');

      // Query interest
      const interest = loop.predict('interest', {
        timeOfDay: 'afternoon',
        dayOfWeek: 2,
        activityType: 'coding',
      });
      expect(interest?.value).toBe('high');
    });
  });

  // ============================================
  // EDGE CASES AND ERROR HANDLING
  // ============================================

  describe('Edge Cases', () => {
    it('should handle empty experience database', () => {
      const db = getTestDb();
      const store = new ExperienceStore(db);
      const measurer = new EvolutionMeasurer(db);

      const experiences = store.getRecent(30);
      expect(experiences.length).toBe(0);

      const metrics = measurer.measure();
      expect(metrics.accuracy).toBe(0);
      expect(metrics.totalPredictions).toBe(0);
    });

    it('should handle patterns with no support', () => {
      const db = getTestDb();
      const distiller = new PatternDistiller(db);
      const store = new ExperienceStore(db);

      const experiences = store.getRecent(30);
      const patterns = distiller.distill(experiences);

      expect(patterns.length).toBe(0);
    });

    it('should handle curriculum without prior state', () => {
      const db = getTestDb();

      // Delete any existing curriculum
      db.prepare('DELETE FROM evolution_curriculum').run();

      const curriculum = new CurriculumManager(db);
      const state = curriculum.getCurriculum();

      expect(state.currentPhase).toBe('exploration');
    });

    it('should match conditions with various operators', () => {
      const db = getTestDb();
      const loop = new SelfEvolutionLoop(db);

      // Create pattern with gt operator
      const patternId = createTestPattern(db, {
        conditions: [{ field: 'tabCount', operator: 'gt', value: 10 }],
        predictedOutcome: 'scattered',
      });

      createTestRule(db, {
        patternId,
        predictionType: 'attention_state',
      });

      // Should match
      const match = loop.predict('attention_state', {
        timeOfDay: 'morning',
        dayOfWeek: 1,
        tabCount: 15,
      });
      expect(match?.value).toBe('scattered');

      // Should not match
      const noMatch = loop.predict('attention_state', {
        timeOfDay: 'morning',
        dayOfWeek: 1,
        tabCount: 5,
      });
      expect(noMatch).toBeNull();
    });
  });
});
