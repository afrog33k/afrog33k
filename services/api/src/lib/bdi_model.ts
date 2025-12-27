/**
 * BDI (Belief-Desire-Intention) User Modeling for Ronald-GI
 *
 * Based on Satori: Proactive AR Assistant (arxiv:2410.16668)
 *
 * The BDI framework models:
 * - Beliefs: What the user thinks is true about the world (expertise, context, preferences)
 * - Desires: What the user wants to achieve (goals, aspirations, needs)
 * - Intentions: What the user plans to do (tasks, projects, explorations)
 *
 * This enables:
 * - Proactive guidance instead of reactive responses
 * - Context-aware anticipation of needs
 * - Personalized assistance based on mental state modeling
 */

import Database from 'better-sqlite3';

// ============================================
// TYPES
// ============================================

export type BeliefType = 'expertise' | 'interest' | 'preference' | 'context';
export type BeliefSource = 'inferred' | 'stated' | 'observed';

export interface Belief {
  id: string;
  userId: string;
  type: BeliefType;
  subject: string;
  predicate: string;
  object: string;
  confidence: number; // 0-1
  source: BeliefSource;
  evidence: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export type DesireType = 'goal' | 'aspiration' | 'need' | 'preference';
export type DesireTimeframe = 'immediate' | 'short-term' | 'long-term' | 'ongoing';
export type DesireStatus = 'active' | 'achieved' | 'abandoned';

export interface Desire {
  id: string;
  userId: string;
  type: DesireType;
  description: string;
  priority: number; // 1-10
  timeframe: DesireTimeframe;
  status: DesireStatus;
  relatedConcepts: string[];
  createdAt: string;
  updatedAt: string;
}

export type IntentionType = 'task' | 'project' | 'habit' | 'exploration';
export type IntentionStatus = 'planned' | 'in_progress' | 'completed' | 'blocked';

export interface Intention {
  id: string;
  userId: string;
  type: IntentionType;
  description: string;
  parentDesireId?: string;
  status: IntentionStatus;
  priority: number;
  deadline?: string;
  context: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface UserMentalState {
  beliefs: Belief[];
  desires: Desire[];
  intentions: Intention[];
  currentFocus?: string;
  cognitiveLoad: 'low' | 'medium' | 'high';
  emotionalState: 'focused' | 'scattered' | 'stressed' | 'relaxed';
}

export interface InferredNeed {
  id: string;
  type: 'information' | 'reminder' | 'guidance' | 'support';
  description: string;
  confidence: number;
  urgency: 'immediate' | 'soon' | 'background';
  basedOn: {
    beliefs: string[];
    desires: string[];
    intentions: string[];
  };
  suggestedAction?: string;
}

// ============================================
// BELIEF MANAGER
// ============================================

export class BeliefManager {
  constructor(private db: Database.Database) {}

  /**
   * Get all beliefs for a user
   */
  getBeliefs(userId: string, type?: BeliefType): Belief[] {
    let query = 'SELECT * FROM user_beliefs WHERE user_id = ?';
    const params: any[] = [userId];

    if (type) {
      query += ' AND belief_type = ?';
      params.push(type);
    }

    query += ' ORDER BY confidence DESC';

    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map(this.mapBelief);
  }

  /**
   * Add or update a belief (with confidence updating)
   */
  upsertBelief(belief: Omit<Belief, 'id' | 'createdAt' | 'updatedAt'>): string {
    const id = this.generateId(`${belief.userId}:${belief.subject}:${belief.predicate}:${belief.object}`);

    const existing = this.db.prepare(
      'SELECT id, confidence FROM user_beliefs WHERE id = ?'
    ).get(id) as { id: string; confidence: number } | undefined;

    if (existing) {
      // Bayesian-style confidence update
      const newConfidence = this.updateConfidence(existing.confidence, belief.confidence, belief.source);

      this.db.prepare(`
        UPDATE user_beliefs
        SET confidence = ?, source = ?, evidence_json = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(newConfidence, belief.source, JSON.stringify(belief.evidence), id);
    } else {
      this.db.prepare(`
        INSERT INTO user_beliefs
        (id, user_id, belief_type, subject, predicate, object, confidence, source, evidence_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, belief.userId, belief.type, belief.subject,
        belief.predicate, belief.object, belief.confidence,
        belief.source, JSON.stringify(belief.evidence)
      );
    }

    return id;
  }

  /**
   * Infer beliefs from user behavior
   */
  inferBeliefsFromBehavior(userId: string, behavior: {
    action: string;
    target: string;
    context: Record<string, any>;
  }): Belief[] {
    const inferred: Belief[] = [];

    // Map actions to belief updates
    if (behavior.action === 'pin' || behavior.action === 'save') {
      inferred.push({
        id: '',
        userId,
        type: 'interest',
        subject: userId,
        predicate: 'is_interested_in',
        object: behavior.target,
        confidence: 0.8,
        source: 'observed',
        evidence: { action: behavior.action, context: behavior.context },
        createdAt: '',
        updatedAt: '',
      });
    }

    if (behavior.action === 'dismiss') {
      inferred.push({
        id: '',
        userId,
        type: 'preference',
        subject: userId,
        predicate: 'dislikes',
        object: behavior.target,
        confidence: 0.6,
        source: 'observed',
        evidence: { action: behavior.action, context: behavior.context },
        createdAt: '',
        updatedAt: '',
      });
    }

    if (behavior.action === 'extended_engagement') {
      inferred.push({
        id: '',
        userId,
        type: 'expertise',
        subject: userId,
        predicate: 'understands',
        object: behavior.target,
        confidence: 0.5,
        source: 'inferred',
        evidence: { action: behavior.action, duration: behavior.context.duration },
        createdAt: '',
        updatedAt: '',
      });
    }

    // Store inferred beliefs
    for (const belief of inferred) {
      this.upsertBelief(belief);
    }

    return inferred;
  }

  /**
   * Get beliefs relevant to a topic
   */
  getRelevantBeliefs(userId: string, topic: string): Belief[] {
    const rows = this.db.prepare(`
      SELECT * FROM user_beliefs
      WHERE user_id = ?
        AND (subject LIKE ? OR object LIKE ?)
      ORDER BY confidence DESC
      LIMIT 20
    `).all(userId, `%${topic}%`, `%${topic}%`) as any[];

    return rows.map(this.mapBelief);
  }

  private updateConfidence(existing: number, new_: number, source: BeliefSource): number {
    // Weight by source reliability
    const sourceWeight: Record<BeliefSource, number> = {
      stated: 0.9,
      observed: 0.7,
      inferred: 0.5,
    };

    const weight = sourceWeight[source];
    return Math.min(0.99, existing * 0.7 + new_ * weight * 0.3);
  }

  private mapBelief(row: any): Belief {
    return {
      id: row.id,
      userId: row.user_id,
      type: row.belief_type,
      subject: row.subject,
      predicate: row.predicate,
      object: row.object,
      confidence: row.confidence,
      source: row.source,
      evidence: row.evidence_json ? JSON.parse(row.evidence_json) : {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private generateId(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(16, '0').slice(0, 16);
  }
}

// ============================================
// DESIRE MANAGER
// ============================================

export class DesireManager {
  constructor(private db: Database.Database) {}

  /**
   * Get all desires for a user
   */
  getDesires(userId: string, status?: DesireStatus): Desire[] {
    let query = 'SELECT * FROM user_desires WHERE user_id = ?';
    const params: any[] = [userId];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY priority DESC';

    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map(this.mapDesire);
  }

  /**
   * Get desires related to concepts
   */
  getRelatedDesires(userId: string, concepts: string[]): Desire[] {
    const desires = this.getDesires(userId, 'active');

    return desires.filter(desire => {
      const relatedConcepts = desire.relatedConcepts.map(c => c.toLowerCase());
      return concepts.some(c => relatedConcepts.includes(c.toLowerCase()));
    });
  }

  /**
   * Create or update a desire
   */
  upsertDesire(desire: Omit<Desire, 'id' | 'createdAt' | 'updatedAt'>): string {
    const id = this.generateId(`${desire.userId}:${desire.description.slice(0, 50)}`);

    this.db.prepare(`
      INSERT INTO user_desires
      (id, user_id, desire_type, description, priority, timeframe, status, related_concepts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        priority = excluded.priority,
        status = excluded.status,
        updated_at = datetime('now')
    `).run(
      id, desire.userId, desire.type, desire.description,
      desire.priority, desire.timeframe, desire.status,
      JSON.stringify(desire.relatedConcepts)
    );

    return id;
  }

  /**
   * Mark a desire as achieved
   */
  achieveDesire(desireId: string): void {
    this.db.prepare(`
      UPDATE user_desires SET status = 'achieved', updated_at = datetime('now')
      WHERE id = ?
    `).run(desireId);
  }

  /**
   * Infer new desires from patterns
   */
  inferDesires(userId: string, recentTopics: string[]): Desire[] {
    const inferred: Desire[] = [];

    // If user is repeatedly engaging with a topic, they probably want to learn more
    const topicCounts = new Map<string, number>();
    for (const topic of recentTopics) {
      topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
    }

    for (const [topic, count] of topicCounts) {
      if (count >= 3) {
        const desire: Omit<Desire, 'id' | 'createdAt' | 'updatedAt'> = {
          userId,
          type: 'need',
          description: `Understand ${topic} more deeply`,
          priority: Math.min(10, 5 + count),
          timeframe: 'short-term',
          status: 'active',
          relatedConcepts: [topic],
        };

        const id = this.upsertDesire(desire);
        inferred.push({ ...desire, id, createdAt: '', updatedAt: '' });
      }
    }

    return inferred;
  }

  private mapDesire(row: any): Desire {
    return {
      id: row.id,
      userId: row.user_id,
      type: row.desire_type,
      description: row.description,
      priority: row.priority,
      timeframe: row.timeframe,
      status: row.status,
      relatedConcepts: row.related_concepts ? JSON.parse(row.related_concepts) : [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private generateId(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(16, '0').slice(0, 16);
  }
}

// ============================================
// INTENTION MANAGER
// ============================================

export class IntentionManager {
  constructor(private db: Database.Database) {}

  /**
   * Get all intentions for a user
   */
  getIntentions(userId: string, status?: IntentionStatus): Intention[] {
    let query = 'SELECT * FROM user_intentions WHERE user_id = ?';
    const params: any[] = [userId];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY priority DESC';

    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map(this.mapIntention);
  }

  /**
   * Get the current active intention
   */
  getCurrentIntention(userId: string): Intention | null {
    const row = this.db.prepare(`
      SELECT * FROM user_intentions
      WHERE user_id = ? AND status = 'in_progress'
      ORDER BY priority DESC
      LIMIT 1
    `).get(userId) as any;

    return row ? this.mapIntention(row) : null;
  }

  /**
   * Create or update an intention
   */
  upsertIntention(intention: Omit<Intention, 'id' | 'createdAt' | 'updatedAt'>): string {
    const id = this.generateId(`${intention.userId}:${intention.description.slice(0, 50)}`);

    this.db.prepare(`
      INSERT INTO user_intentions
      (id, user_id, intention_type, description, parent_desire_id, status, priority, deadline, context_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        priority = excluded.priority,
        context_json = excluded.context_json,
        updated_at = datetime('now')
    `).run(
      id, intention.userId, intention.type, intention.description,
      intention.parentDesireId || null, intention.status, intention.priority,
      intention.deadline || null, JSON.stringify(intention.context)
    );

    return id;
  }

  /**
   * Predict next intention based on current state
   */
  predictNextIntention(userId: string, currentContext: string): Intention | null {
    // Look for patterns in completed intentions
    const patterns = this.db.prepare(`
      SELECT i2.description, COUNT(*) as frequency
      FROM user_intentions i1
      JOIN user_intentions i2 ON i2.user_id = i1.user_id
      WHERE i1.user_id = ?
        AND i1.status = 'completed'
        AND i2.status = 'completed'
        AND i1.description LIKE ?
        AND i2.updated_at > i1.updated_at
        AND julianday(i2.updated_at) - julianday(i1.updated_at) < 1
      GROUP BY i2.description
      ORDER BY frequency DESC
      LIMIT 1
    `).get(userId, `%${currentContext}%`) as any;

    if (patterns) {
      // Check if this intention exists as planned
      const existing = this.db.prepare(`
        SELECT * FROM user_intentions
        WHERE user_id = ? AND description LIKE ? AND status = 'planned'
        LIMIT 1
      `).get(userId, `%${patterns.description}%`) as any;

      if (existing) {
        return this.mapIntention(existing);
      }
    }

    return null;
  }

  /**
   * Update intention status
   */
  updateStatus(intentionId: string, status: IntentionStatus): void {
    this.db.prepare(`
      UPDATE user_intentions SET status = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(status, intentionId);
  }

  private mapIntention(row: any): Intention {
    return {
      id: row.id,
      userId: row.user_id,
      type: row.intention_type,
      description: row.description,
      parentDesireId: row.parent_desire_id,
      status: row.status,
      priority: row.priority,
      deadline: row.deadline,
      context: row.context_json ? JSON.parse(row.context_json) : {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private generateId(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(16, '0').slice(0, 16);
  }
}

// ============================================
// BDI REASONER (Main Integration)
// ============================================

export class BDIReasoner {
  private beliefs: BeliefManager;
  private desires: DesireManager;
  private intentions: IntentionManager;

  constructor(private db: Database.Database) {
    this.beliefs = new BeliefManager(db);
    this.desires = new DesireManager(db);
    this.intentions = new IntentionManager(db);
  }

  /**
   * Get the complete mental state for a user
   */
  getMentalState(userId: string): UserMentalState {
    const beliefs = this.beliefs.getBeliefs(userId);
    const desires = this.desires.getDesires(userId, 'active');
    const intentions = this.intentions.getIntentions(userId);

    const currentIntention = this.intentions.getCurrentIntention(userId);

    // Infer cognitive load from intention count and priorities
    const inProgressCount = intentions.filter(i => i.status === 'in_progress').length;
    const highPriorityCount = intentions.filter(i => i.priority >= 8).length;

    let cognitiveLoad: 'low' | 'medium' | 'high' = 'low';
    if (inProgressCount >= 3 || highPriorityCount >= 5) {
      cognitiveLoad = 'high';
    } else if (inProgressCount >= 2 || highPriorityCount >= 3) {
      cognitiveLoad = 'medium';
    }

    // Infer emotional state from ADHD context
    const hasADHD = beliefs.some(b =>
      b.type === 'context' && b.object.toLowerCase().includes('adhd')
    );
    const emotionalState = hasADHD && cognitiveLoad === 'high' ? 'scattered' : 'focused';

    return {
      beliefs,
      desires,
      intentions,
      currentFocus: currentIntention?.description,
      cognitiveLoad,
      emotionalState,
    };
  }

  /**
   * Infer needs based on BDI state (core reasoning)
   */
  inferNeeds(userId: string, currentContext?: string): InferredNeed[] {
    const state = this.getMentalState(userId);
    const needs: InferredNeed[] = [];

    // 1. Gap analysis: Desires without supporting intentions
    for (const desire of state.desires) {
      const hasIntention = state.intentions.some(
        i => i.parentDesireId === desire.id && i.status !== 'completed'
      );

      if (!hasIntention && desire.priority >= 7) {
        needs.push({
          id: this.generateId(`need:${desire.id}`),
          type: 'guidance',
          description: `No active plan for: ${desire.description}`,
          confidence: 0.8,
          urgency: desire.timeframe === 'immediate' ? 'immediate' : 'soon',
          basedOn: { beliefs: [], desires: [desire.id], intentions: [] },
          suggestedAction: `Create a plan or task for: ${desire.description}`,
        });
      }
    }

    // 2. Blocked intentions needing support
    const blockedIntentions = state.intentions.filter(i => i.status === 'blocked');
    for (const intention of blockedIntentions) {
      needs.push({
        id: this.generateId(`blocked:${intention.id}`),
        type: 'support',
        description: `Blocked: ${intention.description}`,
        confidence: 0.9,
        urgency: intention.priority >= 8 ? 'immediate' : 'soon',
        basedOn: { beliefs: [], desires: [], intentions: [intention.id] },
        suggestedAction: 'Identify and resolve blocker',
      });
    }

    // 3. Context-specific information needs
    if (currentContext) {
      const relevantBeliefs = this.beliefs.getRelevantBeliefs(userId, currentContext);
      const expertiseLevel = relevantBeliefs.filter(b => b.type === 'expertise');

      if (expertiseLevel.length === 0) {
        // User has no expertise beliefs for this context
        needs.push({
          id: this.generateId(`learn:${currentContext}`),
          type: 'information',
          description: `May need learning resources for: ${currentContext}`,
          confidence: 0.6,
          urgency: 'background',
          basedOn: { beliefs: [], desires: [], intentions: [] },
          suggestedAction: `Research ${currentContext}`,
        });
      }
    }

    // 4. ADHD-specific: Reminder for scattered attention
    const isScattered = state.emotionalState === 'scattered';
    const currentIntention = this.intentions.getCurrentIntention(userId);

    if (isScattered && currentIntention) {
      needs.push({
        id: this.generateId(`reminder:${currentIntention.id}`),
        type: 'reminder',
        description: `You were working on: ${currentIntention.description}`,
        confidence: 0.85,
        urgency: 'immediate',
        basedOn: { beliefs: [], desires: [], intentions: [currentIntention.id] },
        suggestedAction: 'Return to current task or take a break',
      });
    }

    // 5. High cognitive load: Suggest prioritization
    if (state.cognitiveLoad === 'high') {
      needs.push({
        id: this.generateId('cognitive-load'),
        type: 'support',
        description: 'High cognitive load detected - consider reducing active tasks',
        confidence: 0.7,
        urgency: 'soon',
        basedOn: {
          beliefs: [],
          desires: [],
          intentions: state.intentions.filter(i => i.status === 'in_progress').map(i => i.id),
        },
        suggestedAction: 'Prioritize or defer some tasks',
      });
    }

    return needs.sort((a, b) => {
      const urgencyOrder = { immediate: 0, soon: 1, background: 2 };
      return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
    });
  }

  /**
   * Update BDI state from user action
   */
  processAction(userId: string, action: string, target: string, context: Record<string, any>): void {
    // Update beliefs from observation
    this.beliefs.inferBeliefsFromBehavior(userId, { action, target, context });

    // Check if action completes an intention
    const intentions = this.intentions.getIntentions(userId, 'in_progress');
    for (const intention of intentions) {
      if (intention.description.toLowerCase().includes(target.toLowerCase())) {
        if (action === 'complete' || action === 'finish') {
          this.intentions.updateStatus(intention.id, 'completed');

          // Check if this achieves a desire
          if (intention.parentDesireId) {
            const siblingIntentions = intentions.filter(
              i => i.parentDesireId === intention.parentDesireId && i.id !== intention.id
            );
            const allComplete = siblingIntentions.every(i => i.status === 'completed');
            if (allComplete) {
              this.desires.achieveDesire(intention.parentDesireId);
            }
          }
        }
      }
    }
  }

  /**
   * Get personalized recommendations based on BDI state
   */
  getRecommendations(userId: string, limit: number = 5): Array<{
    type: string;
    content: string;
    reason: string;
    priority: number;
  }> {
    const state = this.getMentalState(userId);
    const needs = this.inferNeeds(userId);
    const recommendations: Array<{
      type: string;
      content: string;
      reason: string;
      priority: number;
    }> = [];

    // Based on desires
    for (const desire of state.desires.slice(0, 3)) {
      recommendations.push({
        type: 'goal',
        content: desire.description,
        reason: `Priority ${desire.priority} ${desire.type}`,
        priority: desire.priority,
      });
    }

    // Based on inferred needs
    for (const need of needs.slice(0, 3)) {
      recommendations.push({
        type: need.type,
        content: need.description,
        reason: need.suggestedAction || 'Inferred from your activity',
        priority: need.urgency === 'immediate' ? 10 : need.urgency === 'soon' ? 7 : 4,
      });
    }

    return recommendations
      .sort((a, b) => b.priority - a.priority)
      .slice(0, limit);
  }

  // Expose managers for direct access
  getBeliefManager(): BeliefManager { return this.beliefs; }
  getDesireManager(): DesireManager { return this.desires; }
  getIntentionManager(): IntentionManager { return this.intentions; }

  private generateId(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return 'need_' + Math.abs(hash).toString(16).padStart(12, '0').slice(0, 12);
  }
}

// ============================================
// FACTORY
// ============================================

export function createBDIModel(db: Database.Database): BDIReasoner {
  return new BDIReasoner(db);
}
