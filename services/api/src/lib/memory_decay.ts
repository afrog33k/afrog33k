/**
 * Memory Decay System for Ronald-GI
 *
 * Inspired by QuixiAI's AGI Memory biological decay model.
 *
 * Memories decay over time unless reinforced through access,
 * implementing a biological forgetting curve. This prevents
 * stale beliefs from dominating and encourages the system
 * to rely on frequently-accessed, validated information.
 *
 * Key Concepts:
 * - Exponential decay based on time since last access
 * - Access boost: confidence increases when memory is retrieved
 * - Minimum floor: memories never fully disappear
 * - Personalized half-lives per memory type
 */

import type { Database } from 'better-sqlite3';

// ============================================
// TYPES
// ============================================

export interface DecayConfig {
  halfLifeDays: number;        // Days until confidence halves
  accessBoostFactor: number;   // Multiplier on access (e.g., 1.1 = 10% boost)
  minConfidence: number;       // Floor value (e.g., 0.1)
  maxConfidence: number;       // Ceiling value (e.g., 0.99)
}

export interface DecayableMemory {
  id: string;
  confidence: number;
  lastAccessed: Date;
  accessCount: number;
  memoryType: string;
}

export interface DecayResult {
  id: string;
  originalConfidence: number;
  decayedConfidence: number;
  decayFactor: number;
  daysSinceAccess: number;
}

// ============================================
// DEFAULT CONFIGURATIONS
// ============================================

export const DEFAULT_DECAY_CONFIGS: Record<string, DecayConfig> = {
  belief: {
    halfLifeDays: 30,          // Beliefs decay slowly
    accessBoostFactor: 1.05,
    minConfidence: 0.1,
    maxConfidence: 0.99,
  },
  interest: {
    halfLifeDays: 14,          // Interests change faster
    accessBoostFactor: 1.1,
    minConfidence: 0.05,
    maxConfidence: 0.95,
  },
  pattern: {
    halfLifeDays: 21,          // Learned patterns decay moderately
    accessBoostFactor: 1.08,
    minConfidence: 0.1,
    maxConfidence: 0.95,
  },
  rule: {
    halfLifeDays: 28,          // Rules are more stable
    accessBoostFactor: 1.05,
    minConfidence: 0.15,
    maxConfidence: 0.95,
  },
  experience: {
    halfLifeDays: 7,           // Recent experiences matter more
    accessBoostFactor: 1.15,
    minConfidence: 0.05,
    maxConfidence: 0.99,
  },
};

// ============================================
// DECAY CALCULATOR
// ============================================

export class DecayCalculator {
  /**
   * Calculate decay factor using exponential decay
   *
   * Formula: decay_factor = e^(-t / half_life_in_days * ln(2))
   * This gives us 0.5 when t = half_life_in_days
   */
  static calculateDecayFactor(
    daysSinceAccess: number,
    halfLifeDays: number
  ): number {
    const lambda = Math.log(2) / halfLifeDays;
    return Math.exp(-lambda * daysSinceAccess);
  }

  /**
   * Calculate decayed confidence
   */
  static calculateDecayedConfidence(
    baseConfidence: number,
    daysSinceAccess: number,
    config: DecayConfig
  ): number {
    const decayFactor = this.calculateDecayFactor(daysSinceAccess, config.halfLifeDays);
    const decayed = baseConfidence * decayFactor;
    return Math.max(config.minConfidence, Math.min(config.maxConfidence, decayed));
  }

  /**
   * Calculate boosted confidence after access
   */
  static calculateAccessBoost(
    currentConfidence: number,
    config: DecayConfig
  ): number {
    const boosted = currentConfidence * config.accessBoostFactor;
    return Math.min(config.maxConfidence, boosted);
  }

  /**
   * Calculate how much confidence would be lost by now
   */
  static calculateConfidenceLoss(
    originalConfidence: number,
    daysSinceAccess: number,
    config: DecayConfig
  ): number {
    const current = this.calculateDecayedConfidence(
      originalConfidence,
      daysSinceAccess,
      config
    );
    return originalConfidence - current;
  }
}

// ============================================
// MEMORY DECAY MANAGER
// ============================================

export class MemoryDecayManager {
  constructor(private db: Database) {}

  /**
   * Apply decay to beliefs
   */
  decayBeliefs(): DecayResult[] {
    const results: DecayResult[] = [];
    const config = DEFAULT_DECAY_CONFIGS.belief;
    const now = Date.now();

    const beliefs = this.db.prepare(`
      SELECT id, confidence, last_accessed, access_count
      FROM user_beliefs
      WHERE last_accessed IS NOT NULL
    `).all() as any[];

    for (const belief of beliefs) {
      const lastAccessed = new Date(belief.last_accessed);
      const daysSinceAccess = (now - lastAccessed.getTime()) / (1000 * 60 * 60 * 24);

      const decayedConfidence = DecayCalculator.calculateDecayedConfidence(
        belief.confidence,
        daysSinceAccess,
        config
      );

      if (Math.abs(decayedConfidence - belief.confidence) > 0.01) {
        this.db.prepare(`
          UPDATE user_beliefs SET confidence = ? WHERE id = ?
        `).run(decayedConfidence, belief.id);

        results.push({
          id: belief.id,
          originalConfidence: belief.confidence,
          decayedConfidence,
          decayFactor: decayedConfidence / belief.confidence,
          daysSinceAccess,
        });
      }
    }

    return results;
  }

  /**
   * Apply decay to evolution patterns
   */
  decayPatterns(): DecayResult[] {
    const results: DecayResult[] = [];
    const config = DEFAULT_DECAY_CONFIGS.pattern;
    const now = Date.now();

    const patterns = this.db.prepare(`
      SELECT id, confidence, last_updated
      FROM evolution_patterns
    `).all() as any[];

    for (const pattern of patterns) {
      const lastUpdated = new Date(pattern.last_updated);
      const daysSinceAccess = (now - lastUpdated.getTime()) / (1000 * 60 * 60 * 24);

      const decayedConfidence = DecayCalculator.calculateDecayedConfidence(
        pattern.confidence,
        daysSinceAccess,
        config
      );

      if (Math.abs(decayedConfidence - pattern.confidence) > 0.01) {
        this.db.prepare(`
          UPDATE evolution_patterns SET confidence = ? WHERE id = ?
        `).run(decayedConfidence, pattern.id);

        results.push({
          id: pattern.id,
          originalConfidence: pattern.confidence,
          decayedConfidence,
          decayFactor: decayedConfidence / pattern.confidence,
          daysSinceAccess,
        });
      }
    }

    return results;
  }

  /**
   * Apply decay to evolution rules
   */
  decayRules(): DecayResult[] {
    const results: DecayResult[] = [];
    const config = DEFAULT_DECAY_CONFIGS.rule;
    const now = Date.now();

    const rules = this.db.prepare(`
      SELECT id, accuracy, last_used, created_at
      FROM evolution_rules
      WHERE is_active = 1
    `).all() as any[];

    for (const rule of rules) {
      const lastUsed = rule.last_used
        ? new Date(rule.last_used)
        : new Date(rule.created_at);
      const daysSinceAccess = (now - lastUsed.getTime()) / (1000 * 60 * 60 * 24);

      const decayedAccuracy = DecayCalculator.calculateDecayedConfidence(
        rule.accuracy,
        daysSinceAccess,
        config
      );

      if (Math.abs(decayedAccuracy - rule.accuracy) > 0.01) {
        this.db.prepare(`
          UPDATE evolution_rules SET accuracy = ? WHERE id = ?
        `).run(decayedAccuracy, rule.id);

        // Deactivate rules that fall below threshold
        if (decayedAccuracy < 0.3) {
          this.db.prepare(`
            UPDATE evolution_rules SET is_active = 0 WHERE id = ?
          `).run(rule.id);
        }

        results.push({
          id: rule.id,
          originalConfidence: rule.accuracy,
          decayedConfidence: decayedAccuracy,
          decayFactor: decayedAccuracy / rule.accuracy,
          daysSinceAccess,
        });
      }
    }

    return results;
  }

  /**
   * Boost a belief's confidence on access
   */
  boostBeliefOnAccess(beliefId: string): number {
    const config = DEFAULT_DECAY_CONFIGS.belief;

    const belief = this.db.prepare(`
      SELECT confidence FROM user_beliefs WHERE id = ?
    `).get(beliefId) as any;

    if (!belief) return 0;

    const boostedConfidence = DecayCalculator.calculateAccessBoost(
      belief.confidence,
      config
    );

    this.db.prepare(`
      UPDATE user_beliefs
      SET confidence = ?, last_accessed = ?, access_count = access_count + 1
      WHERE id = ?
    `).run(boostedConfidence, new Date().toISOString(), beliefId);

    return boostedConfidence;
  }

  /**
   * Run full decay cycle on all memory types
   */
  runDecayCycle(): {
    beliefs: DecayResult[];
    patterns: DecayResult[];
    rules: DecayResult[];
    timestamp: Date;
  } {
    return {
      beliefs: this.decayBeliefs(),
      patterns: this.decayPatterns(),
      rules: this.decayRules(),
      timestamp: new Date(),
    };
  }

  /**
   * Get decay statistics
   */
  getDecayStats(): {
    beliefsAtRisk: number;     // Beliefs below 0.3 confidence
    patternsAtRisk: number;
    rulesAtRisk: number;
    oldestAccess: Date | null;
  } {
    const beliefsAtRisk = (this.db.prepare(`
      SELECT COUNT(*) as count FROM user_beliefs WHERE confidence < 0.3
    `).get() as any).count;

    const patternsAtRisk = (this.db.prepare(`
      SELECT COUNT(*) as count FROM evolution_patterns WHERE confidence < 0.3
    `).get() as any).count;

    const rulesAtRisk = (this.db.prepare(`
      SELECT COUNT(*) as count FROM evolution_rules WHERE accuracy < 0.3 AND is_active = 1
    `).get() as any).count;

    const oldest = this.db.prepare(`
      SELECT MIN(last_accessed) as oldest FROM user_beliefs WHERE last_accessed IS NOT NULL
    `).get() as any;

    return {
      beliefsAtRisk,
      patternsAtRisk,
      rulesAtRisk,
      oldestAccess: oldest?.oldest ? new Date(oldest.oldest) : null,
    };
  }
}

// ============================================
// EXPORTS
// ============================================

export default {
  DecayCalculator,
  MemoryDecayManager,
  DEFAULT_DECAY_CONFIGS,
};
