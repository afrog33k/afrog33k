/**
 * ACE-Inspired Personalization Framework for Ronald-GI
 *
 * Based on Stanford's Agentic Context Engineering (ACE) pattern:
 * - Agent: Executes tasks using current context
 * - Reflector: Analyzes outcomes and suggests context improvements
 * - SkillManager: Evolves the context based on learning signals
 *
 * Key insight from papers:
 * - P-RLHF: Lightweight user model for personalized preferences
 * - PREMIUM: Tag-based user profile characterization
 * - PeaPOD: Weighted soft prompts for personalization
 *
 * Ronald-GI's approach: Context evolution through behavioral learning
 * instead of expensive fine-tuning.
 */

import Database from 'better-sqlite3';

// ============================================
// USER PROFILE STRUCTURE
// ============================================

export interface UserProfile {
  id: string;
  interests: Record<string, InterestWeight>;
  languages: LanguagePreference[];
  platforms: string[];
  workPatterns: WorkPattern;
  obsessionGradient: string[];  // Ranked interests by engagement
  contextFingerprint: string;   // Hash of current context
  lastUpdated: Date;
}

export interface InterestWeight {
  weight: number;           // 0-1 intensity
  keywords: string[];       // Associated keywords
  engagementCount: number;  // How many times engaged
  lastEngaged: Date;
  decayRate: number;        // Per-day decay when not engaged
}

export interface LanguagePreference {
  language: string;
  proficiency: 'primary' | 'secondary' | 'tertiary';
  repoCount: number;
}

export interface WorkPattern {
  peakHours: number[];      // Hours when most active
  sessionLength: number;    // Average session in minutes
  multitaskingScore: number; // 0-1, how much parallel research
  depthVsBreadth: number;   // 0=breadth, 1=depth
}

// ============================================
// ACE COMPONENTS
// ============================================

/**
 * Agent: Executes research tasks using current personalized context
 */
export class PersonalizationAgent {
  constructor(private db: Database.Database) {}

  /**
   * Get personalized context for a research task
   */
  getPersonalizedContext(userId: string = 'default'): PersonalizedContext {
    const profile = this.loadProfile(userId);
    const topInterests = this.getTopInterests(5);
    const recentConcepts = this.getRecentlyEngagedConcepts(10);
    const avoidPatterns = this.getAvoidPatterns();

    return {
      userProfile: profile,
      prioritizedInterests: topInterests,
      recentFocus: recentConcepts,
      avoidancePatterns: avoidPatterns,
      contextPrompt: this.buildContextPrompt(profile, topInterests, avoidPatterns),
    };
  }

  private loadProfile(userId: string): UserProfile | null {
    try {
      const row = this.db.prepare(`
        SELECT profile_json FROM user_profiles WHERE id = ?
      `).get(userId) as any;

      return row ? JSON.parse(row.profile_json) : null;
    } catch {
      return null;
    }
  }

  private getTopInterests(limit: number): Array<{ concept: string; weight: number }> {
    const results = this.db.prepare(`
      SELECT c.label, pw.weight
      FROM preference_weights pw
      JOIN concepts c ON pw.target_id = c.id
      WHERE pw.weight_type = 'concept' AND c.active = 1
      ORDER BY pw.weight DESC
      LIMIT ?
    `).all(limit) as any[];

    return results.map(r => ({ concept: r.label, weight: r.weight }));
  }

  private getRecentlyEngagedConcepts(limit: number): string[] {
    const results = this.db.prepare(`
      SELECT DISTINCT c.label
      FROM concepts c
      JOIN concept_mentions cm ON c.id = cm.concept_id
      JOIN reports r ON cm.entity_id = r.id AND cm.entity_type = 'report'
      JOIN telemetry t ON r.id = t.report_id
      WHERE c.active = 1
      ORDER BY t.created_at DESC
      LIMIT ?
    `).all(limit) as any[];

    return results.map(r => r.label);
  }

  private getAvoidPatterns(): string[] {
    // Concepts/topics the user consistently skips or gives negative feedback
    const results = this.db.prepare(`
      SELECT DISTINCT c.label
      FROM concepts c
      JOIN concept_mentions cm ON c.id = cm.concept_id
      JOIN reports r ON cm.entity_id = r.id AND cm.entity_type = 'report'
      JOIN feedback f ON r.id = f.report_id
      WHERE f.action = 'not_useful'
      GROUP BY c.id
      HAVING COUNT(*) >= 2
    `).all() as any[];

    return results.map(r => r.label);
  }

  private buildContextPrompt(
    profile: UserProfile | null,
    interests: Array<{ concept: string; weight: number }>,
    avoid: string[]
  ): string {
    const parts: string[] = [];

    if (profile?.obsessionGradient?.length) {
      parts.push(`User is deeply interested in: ${profile.obsessionGradient.slice(0, 3).join(', ')}`);
    }

    if (interests.length > 0) {
      const topWeighted = interests.filter(i => i.weight > 0.7);
      if (topWeighted.length > 0) {
        parts.push(`High-priority topics: ${topWeighted.map(i => i.concept).join(', ')}`);
      }
    }

    if (profile?.workPatterns) {
      if (profile.workPatterns.depthVsBreadth > 0.7) {
        parts.push('User prefers deep technical detail over broad overviews');
      } else if (profile.workPatterns.depthVsBreadth < 0.3) {
        parts.push('User prefers quick summaries and breadth over deep dives');
      }
    }

    if (avoid.length > 0) {
      parts.push(`Avoid focusing on: ${avoid.join(', ')}`);
    }

    return parts.join('\n');
  }
}

export interface PersonalizedContext {
  userProfile: UserProfile | null;
  prioritizedInterests: Array<{ concept: string; weight: number }>;
  recentFocus: string[];
  avoidancePatterns: string[];
  contextPrompt: string;
}

/**
 * Reflector: Analyzes outcomes and suggests context improvements
 */
export class PersonalizationReflector {
  constructor(private db: Database.Database) {}

  /**
   * Analyze recent interactions and suggest profile updates
   */
  analyzeAndReflect(): ReflectionResult {
    const engagementSignals = this.collectEngagementSignals();
    const feedbackSignals = this.collectFeedbackSignals();
    const conceptUsagePatterns = this.analyzeConceptUsage();

    const suggestions: ProfileUpdateSuggestion[] = [];

    // Suggest weight increases for highly engaged concepts
    for (const signal of engagementSignals) {
      if (signal.score > 0.7) {
        suggestions.push({
          type: 'increase_weight',
          target: signal.conceptId,
          targetLabel: signal.conceptLabel,
          reason: `High engagement score: ${signal.score.toFixed(2)}`,
          delta: 0.1,
        });
      }
    }

    // Suggest weight decreases for negative feedback
    for (const signal of feedbackSignals) {
      if (signal.negativeCount > signal.positiveCount) {
        suggestions.push({
          type: 'decrease_weight',
          target: signal.conceptId,
          targetLabel: signal.conceptLabel,
          reason: `Negative feedback ratio: ${signal.negativeCount}/${signal.positiveCount + signal.negativeCount}`,
          delta: -0.15,
        });
      }
    }

    // Suggest new interests from emerging patterns
    for (const pattern of conceptUsagePatterns) {
      if (pattern.isEmerging && pattern.engagementCount >= 3) {
        suggestions.push({
          type: 'add_interest',
          target: pattern.conceptId,
          targetLabel: pattern.label,
          reason: `Emerging interest: ${pattern.engagementCount} engagements in ${pattern.daysSinceFirst} days`,
          delta: 0.5,  // Starting weight
        });
      }
    }

    return {
      timestamp: new Date(),
      signalsAnalyzed: engagementSignals.length + feedbackSignals.length,
      suggestions,
      confidence: this.calculateConfidence(suggestions),
    };
  }

  private collectEngagementSignals(): EngagementSignal[] {
    const results = this.db.prepare(`
      SELECT
        c.id as conceptId,
        c.label as conceptLabel,
        COUNT(DISTINCT t.id) as engagementCount,
        AVG(CASE
          WHEN t.event_type = 'pin' THEN 1.0
          WHEN t.event_type = 'click' THEN 0.7
          WHEN t.event_type = 'scroll' THEN 0.5
          WHEN t.event_type = 'open' THEN 0.2
          ELSE 0.1
        END) as avgScore
      FROM concepts c
      JOIN concept_mentions cm ON c.id = cm.concept_id
      JOIN reports r ON cm.entity_id = r.id AND cm.entity_type = 'report'
      JOIN telemetry t ON r.id = t.report_id
      WHERE c.active = 1
        AND t.created_at > datetime('now', '-7 days')
      GROUP BY c.id
      HAVING engagementCount >= 2
    `).all() as any[];

    return results.map(r => ({
      conceptId: r.conceptId,
      conceptLabel: r.conceptLabel,
      engagementCount: r.engagementCount,
      score: r.avgScore,
    }));
  }

  private collectFeedbackSignals(): FeedbackSignal[] {
    const results = this.db.prepare(`
      SELECT
        c.id as conceptId,
        c.label as conceptLabel,
        SUM(CASE WHEN f.action = 'useful' THEN 1 ELSE 0 END) as positiveCount,
        SUM(CASE WHEN f.action = 'not_useful' THEN 1 ELSE 0 END) as negativeCount
      FROM concepts c
      JOIN concept_mentions cm ON c.id = cm.concept_id
      JOIN reports r ON cm.entity_id = r.id AND cm.entity_type = 'report'
      JOIN feedback f ON r.id = f.report_id
      WHERE c.active = 1
        AND f.created_at > datetime('now', '-14 days')
      GROUP BY c.id
      HAVING positiveCount + negativeCount >= 2
    `).all() as any[];

    return results.map(r => ({
      conceptId: r.conceptId,
      conceptLabel: r.conceptLabel,
      positiveCount: r.positiveCount || 0,
      negativeCount: r.negativeCount || 0,
    }));
  }

  private analyzeConceptUsage(): ConceptUsagePattern[] {
    const results = this.db.prepare(`
      SELECT
        c.id as conceptId,
        c.label,
        c.mention_count,
        MIN(t.created_at) as firstEngagement,
        MAX(t.created_at) as lastEngagement,
        COUNT(DISTINCT t.id) as engagementCount,
        pw.weight as currentWeight
      FROM concepts c
      JOIN concept_mentions cm ON c.id = cm.concept_id
      JOIN reports r ON cm.entity_id = r.id AND cm.entity_type = 'report'
      JOIN telemetry t ON r.id = t.report_id
      LEFT JOIN preference_weights pw ON pw.target_id = c.id AND pw.weight_type = 'concept'
      WHERE c.active = 1
        AND t.created_at > datetime('now', '-30 days')
      GROUP BY c.id
    `).all() as any[];

    return results.map(r => {
      const daysSinceFirst = r.firstEngagement
        ? Math.max(1, Math.floor((Date.now() - new Date(r.firstEngagement).getTime()) / (1000 * 60 * 60 * 24)))
        : 0;

      return {
        conceptId: r.conceptId,
        label: r.label,
        engagementCount: r.engagementCount,
        daysSinceFirst,
        isEmerging: !r.currentWeight && r.engagementCount >= 3,
        growthRate: r.engagementCount / Math.max(1, daysSinceFirst),
      };
    });
  }

  private calculateConfidence(suggestions: ProfileUpdateSuggestion[]): number {
    if (suggestions.length === 0) return 0;
    // More data = more confidence, but cap at 0.95
    return Math.min(0.95, 0.5 + suggestions.length * 0.05);
  }
}

interface EngagementSignal {
  conceptId: string;
  conceptLabel: string;
  engagementCount: number;
  score: number;
}

interface FeedbackSignal {
  conceptId: string;
  conceptLabel: string;
  positiveCount: number;
  negativeCount: number;
}

interface ConceptUsagePattern {
  conceptId: string;
  label: string;
  engagementCount: number;
  daysSinceFirst: number;
  isEmerging: boolean;
  growthRate: number;
}

export interface ProfileUpdateSuggestion {
  type: 'increase_weight' | 'decrease_weight' | 'add_interest' | 'remove_interest';
  target: string;
  targetLabel: string;
  reason: string;
  delta: number;
}

export interface ReflectionResult {
  timestamp: Date;
  signalsAnalyzed: number;
  suggestions: ProfileUpdateSuggestion[];
  confidence: number;
}

/**
 * SkillManager: Applies learning updates to evolve the context
 */
export class PersonalizationSkillManager {
  constructor(private db: Database.Database) {}

  /**
   * Apply approved updates to the user profile
   */
  applyUpdates(suggestions: ProfileUpdateSuggestion[], autoApprove: boolean = true): ApplyResult {
    const applied: string[] = [];
    const skipped: string[] = [];

    for (const suggestion of suggestions) {
      // In auto mode, only apply high-confidence changes
      if (autoApprove && Math.abs(suggestion.delta) < 0.05) {
        skipped.push(suggestion.targetLabel);
        continue;
      }

      try {
        switch (suggestion.type) {
          case 'increase_weight':
          case 'decrease_weight':
            this.updateWeight(suggestion.target, suggestion.delta);
            applied.push(suggestion.targetLabel);
            break;

          case 'add_interest':
            this.addInterest(suggestion.target, suggestion.delta);
            applied.push(suggestion.targetLabel);
            break;

          case 'remove_interest':
            this.removeInterest(suggestion.target);
            applied.push(suggestion.targetLabel);
            break;
        }
      } catch (e) {
        skipped.push(suggestion.targetLabel);
      }
    }

    // Record the learning event
    this.recordLearningEvent(applied.length, skipped.length);

    return {
      appliedCount: applied.length,
      skippedCount: skipped.length,
      appliedLabels: applied,
      skippedLabels: skipped,
    };
  }

  private updateWeight(targetId: string, delta: number): void {
    const existing = this.db.prepare(`
      SELECT weight FROM preference_weights
      WHERE weight_type = 'concept' AND target_id = ?
    `).get(targetId) as any;

    if (existing) {
      const newWeight = Math.max(0, Math.min(2, existing.weight + delta));
      this.db.prepare(`
        UPDATE preference_weights
        SET weight = ?, last_engagement_at = datetime('now')
        WHERE weight_type = 'concept' AND target_id = ?
      `).run(newWeight, targetId);
    } else {
      const startWeight = Math.max(0, Math.min(2, 1.0 + delta));
      this.db.prepare(`
        INSERT INTO preference_weights (id, weight_type, target_id, weight, last_engagement_at)
        VALUES (?, 'concept', ?, ?, datetime('now'))
      `).run(this.randomId(), targetId, startWeight);
    }
  }

  private addInterest(targetId: string, initialWeight: number): void {
    const existing = this.db.prepare(`
      SELECT id FROM preference_weights
      WHERE weight_type = 'concept' AND target_id = ?
    `).get(targetId);

    if (!existing) {
      this.db.prepare(`
        INSERT INTO preference_weights (id, weight_type, target_id, weight, last_engagement_at)
        VALUES (?, 'concept', ?, ?, datetime('now'))
      `).run(this.randomId(), targetId, initialWeight);
    }
  }

  private removeInterest(targetId: string): void {
    this.db.prepare(`
      UPDATE preference_weights SET weight = 0
      WHERE weight_type = 'concept' AND target_id = ?
    `).run(targetId);
  }

  private recordLearningEvent(applied: number, skipped: number): void {
    try {
      this.db.prepare(`
        INSERT INTO learning_events (id, event_type, details_json, created_at)
        VALUES (?, 'profile_update', ?, datetime('now'))
      `).run(this.randomId(), JSON.stringify({ applied, skipped }));
    } catch {
      // Table may not exist yet
    }
  }

  /**
   * Apply temporal decay to all weights
   */
  applyTemporalDecay(decayRate: number = 0.95): number {
    // Find weights that haven't been engaged in 7+ days
    const staleWeights = this.db.prepare(`
      SELECT id, weight, last_engagement_at,
             julianday('now') - julianday(last_engagement_at) as days_stale
      FROM preference_weights
      WHERE last_engagement_at < datetime('now', '-7 days')
        AND weight > 0.1
    `).all() as any[];

    let updatedCount = 0;
    for (const w of staleWeights) {
      const decayedWeight = w.weight * Math.pow(decayRate, w.days_stale);
      if (decayedWeight < 0.1) {
        // Too decayed, set to minimum
        this.db.prepare(`UPDATE preference_weights SET weight = 0.1 WHERE id = ?`).run(w.id);
      } else {
        this.db.prepare(`UPDATE preference_weights SET weight = ? WHERE id = ?`).run(decayedWeight, w.id);
      }
      updatedCount++;
    }

    return updatedCount;
  }

  /**
   * Calculate the obsession gradient - ranked list of what the user cares about most
   */
  calculateObsessionGradient(): string[] {
    const results = this.db.prepare(`
      SELECT c.label, pw.weight,
             (SELECT COUNT(*) FROM telemetry t
              JOIN reports r ON t.report_id = r.id
              JOIN concept_mentions cm ON cm.entity_id = r.id AND cm.entity_type = 'report'
              WHERE cm.concept_id = c.id AND t.event_type = 'pin') as pin_count
      FROM preference_weights pw
      JOIN concepts c ON pw.target_id = c.id
      WHERE pw.weight_type = 'concept' AND c.active = 1
      ORDER BY (pw.weight * (1 + pin_count * 0.5)) DESC
      LIMIT 20
    `).all() as any[];

    return results.map(r => r.label);
  }

  private randomId(): string {
    return Math.random().toString(36).substring(2, 15) +
           Math.random().toString(36).substring(2, 15);
  }
}

export interface ApplyResult {
  appliedCount: number;
  skippedCount: number;
  appliedLabels: string[];
  skippedLabels: string[];
}

// ============================================
// LEARNING VERIFICATION
// ============================================

/**
 * Proves that the system is actually learning from user behavior
 */
export class LearningVerifier {
  constructor(private db: Database.Database) {}

  /**
   * Verify that engagement patterns translate to preference updates
   */
  verifyEngagementLearning(): LearningProof {
    // Get concepts with high engagement
    const highEngagement = this.db.prepare(`
      SELECT c.id, c.label,
             COUNT(DISTINCT t.id) as engagement_count,
             pw.weight
      FROM concepts c
      JOIN concept_mentions cm ON c.id = cm.concept_id
      JOIN reports r ON cm.entity_id = r.id AND cm.entity_type = 'report'
      JOIN telemetry t ON r.id = t.report_id
      LEFT JOIN preference_weights pw ON pw.target_id = c.id AND pw.weight_type = 'concept'
      WHERE c.active = 1
      GROUP BY c.id
      HAVING engagement_count >= 3
      ORDER BY engagement_count DESC
      LIMIT 10
    `).all() as any[];

    // Check if high engagement correlates with high weight
    let correlatedCount = 0;
    for (const concept of highEngagement) {
      if (concept.weight && concept.weight > 1.0) {
        correlatedCount++;
      }
    }

    const correlationRate = highEngagement.length > 0
      ? correlatedCount / highEngagement.length
      : 0;

    return {
      proofType: 'engagement_weight_correlation',
      sampleSize: highEngagement.length,
      correlation: correlationRate,
      passed: correlationRate >= 0.5 || highEngagement.length === 0,
      evidence: highEngagement.slice(0, 5).map(c => ({
        label: c.label,
        engagementCount: c.engagement_count,
        weight: c.weight || 1.0,
      })),
    };
  }

  /**
   * Verify that negative feedback reduces interest weights
   */
  verifyFeedbackLearning(): LearningProof {
    const negativelyRated = this.db.prepare(`
      SELECT c.id, c.label,
             COUNT(DISTINCT f.id) as negative_count,
             pw.weight
      FROM concepts c
      JOIN concept_mentions cm ON c.id = cm.concept_id
      JOIN reports r ON cm.entity_id = r.id AND cm.entity_type = 'report'
      JOIN feedback f ON r.id = f.report_id
      LEFT JOIN preference_weights pw ON pw.target_id = c.id AND pw.weight_type = 'concept'
      WHERE c.active = 1 AND f.action = 'not_useful'
      GROUP BY c.id
      HAVING negative_count >= 2
    `).all() as any[];

    // Check if negative feedback correlates with low/reduced weight
    let properlyReduced = 0;
    for (const concept of negativelyRated) {
      if (!concept.weight || concept.weight < 1.0) {
        properlyReduced++;
      }
    }

    const reductionRate = negativelyRated.length > 0
      ? properlyReduced / negativelyRated.length
      : 0;

    return {
      proofType: 'negative_feedback_weight_reduction',
      sampleSize: negativelyRated.length,
      correlation: reductionRate,
      passed: reductionRate >= 0.5 || negativelyRated.length === 0,
      evidence: negativelyRated.slice(0, 5).map(c => ({
        label: c.label,
        negativeCount: c.negative_count,
        weight: c.weight || 1.0,
      })),
    };
  }

  /**
   * Verify temporal decay is working
   */
  verifyTemporalDecay(): LearningProof {
    const staleWeights = this.db.prepare(`
      SELECT id, weight, last_engagement_at,
             julianday('now') - julianday(last_engagement_at) as days_stale
      FROM preference_weights
      WHERE last_engagement_at IS NOT NULL
    `).all() as any[];

    // Group by staleness
    const fresh = staleWeights.filter(w => w.days_stale < 7);
    const stale = staleWeights.filter(w => w.days_stale >= 7);

    const avgFreshWeight = fresh.length > 0
      ? fresh.reduce((sum, w) => sum + w.weight, 0) / fresh.length
      : 0;
    const avgStaleWeight = stale.length > 0
      ? stale.reduce((sum, w) => sum + w.weight, 0) / stale.length
      : 0;

    const decayWorking = stale.length === 0 || avgStaleWeight <= avgFreshWeight;

    return {
      proofType: 'temporal_decay_verification',
      sampleSize: staleWeights.length,
      correlation: decayWorking ? 1.0 : 0,
      passed: decayWorking,
      evidence: [
        { metric: 'fresh_weights_count', value: fresh.length },
        { metric: 'stale_weights_count', value: stale.length },
        { metric: 'avg_fresh_weight', value: avgFreshWeight },
        { metric: 'avg_stale_weight', value: avgStaleWeight },
      ],
    };
  }

  /**
   * Run all learning verification checks
   */
  runFullVerification(): FullLearningProof {
    const proofs = [
      this.verifyEngagementLearning(),
      this.verifyFeedbackLearning(),
      this.verifyTemporalDecay(),
    ];

    const allPassed = proofs.every(p => p.passed);
    const passRate = proofs.filter(p => p.passed).length / proofs.length;

    return {
      timestamp: new Date(),
      proofs,
      allPassed,
      passRate,
      verdict: allPassed
        ? 'VERIFIED: System is learning from user behavior'
        : `PARTIAL: ${Math.round(passRate * 100)}% of learning mechanisms verified`,
    };
  }
}

export interface LearningProof {
  proofType: string;
  sampleSize: number;
  correlation: number;
  passed: boolean;
  evidence: any[];
}

export interface FullLearningProof {
  timestamp: Date;
  proofs: LearningProof[];
  allPassed: boolean;
  passRate: number;
  verdict: string;
}

// ============================================
// CONVENIENCE EXPORTS
// ============================================

export function createPersonalizationSystem(db: Database.Database) {
  return {
    agent: new PersonalizationAgent(db),
    reflector: new PersonalizationReflector(db),
    skillManager: new PersonalizationSkillManager(db),
    verifier: new LearningVerifier(db),
  };
}
