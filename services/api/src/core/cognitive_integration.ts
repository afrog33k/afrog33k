/**
 * Cognitive Integration Layer
 *
 * Wires existing Ronald-GI modules into the Living Core:
 * - BDI Model: User intent understanding from observations
 * - Drives: Value/cost evaluation based on motivational state
 * - Attention: Behavior adjustment based on ADHD state
 * - Anticipation: Proactive surfacing of relevant content
 *
 * This creates a cohesive cognitive system where:
 * - Observations update beliefs, desires, and intentions
 * - Drive states influence which rabbit holes are pursued
 * - Attention state adjusts heartbeat timing and interruption behavior
 * - Anticipation proactively surfaces relevant content
 */

import Database from 'better-sqlite3';
import { EventEmitter } from 'events';

// Import from existing modules (we'll re-implement key parts inline for now)
// In production, these would be: import { BeliefManager, ... } from '../lib/bdi_model';

// ============================================================================
// TYPES (from existing modules)
// ============================================================================

export type BeliefType = 'expertise' | 'interest' | 'preference' | 'context';
export type BeliefSource = 'inferred' | 'stated' | 'observed';

export interface UserBelief {
  id: string;
  type: BeliefType;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  source: BeliefSource;
  createdAt: Date;
}

export interface UserDesire {
  id: string;
  type: 'goal' | 'aspiration' | 'need' | 'preference';
  description: string;
  priority: number;
  timeframe: 'immediate' | 'short-term' | 'long-term' | 'ongoing';
  status: 'active' | 'achieved' | 'abandoned';
  relatedConcepts: string[];
}

export interface UserIntention {
  id: string;
  type: 'task' | 'project' | 'habit' | 'exploration';
  description: string;
  status: 'planned' | 'in_progress' | 'completed' | 'blocked';
  priority: number;
  parentDesireId?: string;
}

export type DriveType = 'focus' | 'completion' | 'novelty' | 'rest' | 'curiosity' | 'connection' | 'mastery';

export interface Drive {
  type: DriveType;
  level: number;
  baselineLevel: number;
  satisfactionThreshold: number;
  lastSatisfied?: Date;
}

export type AttentionState = 'focused' | 'scattered' | 'hyperfocus' | 'crashed' | 'transitioning' | 'unknown';

export interface AttentionSnapshot {
  state: AttentionState;
  confidence: number;
  cognitiveLoad: 'low' | 'medium' | 'high' | 'overload';
  switchFrequency: number;
  focusScore: number;
}

export interface InferredNeed {
  id: string;
  type: 'information' | 'reminder' | 'guidance' | 'support';
  description: string;
  confidence: number;
  urgency: 'immediate' | 'soon' | 'background';
  suggestedAction?: string;
}

// ============================================================================
// COGNITIVE INTEGRATION
// ============================================================================

export class CognitiveIntegration extends EventEmitter {
  private db: Database.Database;
  private userId: string = 'default';

  constructor(db: Database.Database) {
    super();
    this.db = db;
    this.initializeSchema();
    this.initializeDefaultDrives();
  }

  // ==========================================================================
  // SCHEMA
  // ==========================================================================

  private initializeSchema(): void {
    this.db.exec(`
      -- User beliefs (BDI)
      CREATE TABLE IF NOT EXISTS user_beliefs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'default',
        belief_type TEXT NOT NULL,
        subject TEXT NOT NULL,
        predicate TEXT NOT NULL,
        object TEXT NOT NULL,
        confidence REAL DEFAULT 0.5,
        source TEXT DEFAULT 'inferred',
        evidence_json TEXT DEFAULT '{}',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      -- User desires (BDI)
      CREATE TABLE IF NOT EXISTS user_desires (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'default',
        desire_type TEXT NOT NULL,
        description TEXT NOT NULL,
        priority INTEGER DEFAULT 5,
        timeframe TEXT DEFAULT 'ongoing',
        status TEXT DEFAULT 'active',
        related_concepts TEXT DEFAULT '[]',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      -- User intentions (BDI)
      CREATE TABLE IF NOT EXISTS user_intentions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'default',
        intention_type TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT DEFAULT 'planned',
        priority INTEGER DEFAULT 5,
        parent_desire_id TEXT,
        context_json TEXT DEFAULT '{}',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      -- Drives (motivational forces)
      CREATE TABLE IF NOT EXISTS drives (
        drive_type TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'default',
        level REAL DEFAULT 50,
        baseline_level REAL DEFAULT 50,
        accumulation_rate REAL DEFAULT 3,
        decay_rate REAL DEFAULT 1,
        satisfaction_threshold REAL DEFAULT 70,
        last_satisfied TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      -- Attention events
      CREATE TABLE IF NOT EXISTS attention_events (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'default',
        timestamp TEXT NOT NULL,
        event_type TEXT NOT NULL,
        context TEXT,
        duration_ms INTEGER,
        metadata_json TEXT DEFAULT '{}'
      );

      -- Attention state history
      CREATE TABLE IF NOT EXISTS attention_states (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL DEFAULT 'default',
        state TEXT NOT NULL,
        confidence REAL,
        cognitive_load TEXT,
        switch_frequency REAL,
        focus_score REAL,
        timestamp TEXT DEFAULT CURRENT_TIMESTAMP
      );

      -- Create indexes
      CREATE INDEX IF NOT EXISTS idx_beliefs_user ON user_beliefs(user_id);
      CREATE INDEX IF NOT EXISTS idx_beliefs_type ON user_beliefs(belief_type);
      CREATE INDEX IF NOT EXISTS idx_desires_user ON user_desires(user_id);
      CREATE INDEX IF NOT EXISTS idx_desires_status ON user_desires(status);
      CREATE INDEX IF NOT EXISTS idx_intentions_user ON user_intentions(user_id);
      CREATE INDEX IF NOT EXISTS idx_intentions_status ON user_intentions(status);
      CREATE INDEX IF NOT EXISTS idx_attention_events_user ON attention_events(user_id, timestamp);
    `);
  }

  private initializeDefaultDrives(): void {
    const drives: Array<{ type: DriveType; baseline: number; threshold: number }> = [
      { type: 'focus', baseline: 30, threshold: 70 },
      { type: 'completion', baseline: 20, threshold: 60 },
      { type: 'novelty', baseline: 40, threshold: 75 },
      { type: 'rest', baseline: 10, threshold: 60 },
      { type: 'curiosity', baseline: 50, threshold: 80 },
      { type: 'connection', baseline: 30, threshold: 65 },
      { type: 'mastery', baseline: 40, threshold: 70 },
    ];

    for (const drive of drives) {
      this.db.prepare(`
        INSERT OR IGNORE INTO drives (drive_type, level, baseline_level, satisfaction_threshold)
        VALUES (?, ?, ?, ?)
      `).run(drive.type, drive.baseline, drive.baseline, drive.threshold);
    }
  }

  // ==========================================================================
  // BDI: BELIEFS
  // ==========================================================================

  /**
   * Infer beliefs from an observation
   */
  inferBeliefsFromObservation(content: string, concepts: string[]): UserBelief[] {
    const beliefs: UserBelief[] = [];

    // Infer interest beliefs from concepts
    for (const concept of concepts) {
      const beliefId = this.generateId(`interest:${concept}`);

      // Check if belief exists and update confidence
      const existing = this.db.prepare(`
        SELECT confidence FROM user_beliefs WHERE id = ?
      `).get(beliefId) as { confidence: number } | undefined;

      const newConfidence = existing
        ? Math.min(1, existing.confidence + 0.1) // Increase confidence with repeated mentions
        : 0.3; // Initial confidence

      this.db.prepare(`
        INSERT INTO user_beliefs (id, belief_type, subject, predicate, object, confidence, source)
        VALUES (?, 'interest', 'user', 'interested_in', ?, ?, 'inferred')
        ON CONFLICT(id) DO UPDATE SET
          confidence = ?,
          updated_at = datetime('now')
      `).run(beliefId, concept, newConfidence, newConfidence);

      beliefs.push({
        id: beliefId,
        type: 'interest',
        subject: 'user',
        predicate: 'interested_in',
        object: concept,
        confidence: newConfidence,
        source: 'inferred',
        createdAt: new Date(),
      });
    }

    // Infer context beliefs from content patterns
    if (/\b(build|create|implement|develop)\b/i.test(content)) {
      const beliefId = this.generateId('context:building');
      this.db.prepare(`
        INSERT INTO user_beliefs (id, belief_type, subject, predicate, object, confidence, source)
        VALUES (?, 'context', 'user', 'currently', 'building_something', 0.6, 'inferred')
        ON CONFLICT(id) DO UPDATE SET confidence = 0.6, updated_at = datetime('now')
      `).run(beliefId);
    }

    if (/\b(research|learn|understand|explore)\b/i.test(content)) {
      const beliefId = this.generateId('context:researching');
      this.db.prepare(`
        INSERT INTO user_beliefs (id, belief_type, subject, predicate, object, confidence, source)
        VALUES (?, 'context', 'user', 'currently', 'researching', 0.6, 'inferred')
        ON CONFLICT(id) DO UPDATE SET confidence = 0.6, updated_at = datetime('now')
      `).run(beliefId);
    }

    this.emit('beliefs_updated', { beliefs });
    return beliefs;
  }

  /**
   * Get current beliefs
   */
  getBeliefs(type?: BeliefType): UserBelief[] {
    let query = 'SELECT * FROM user_beliefs WHERE user_id = ?';
    const params: any[] = [this.userId];

    if (type) {
      query += ' AND belief_type = ?';
      params.push(type);
    }

    query += ' ORDER BY confidence DESC LIMIT 50';

    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map(row => ({
      id: row.id,
      type: row.belief_type,
      subject: row.subject,
      predicate: row.predicate,
      object: row.object,
      confidence: row.confidence,
      source: row.source,
      createdAt: new Date(row.created_at),
    }));
  }

  // ==========================================================================
  // BDI: DESIRES
  // ==========================================================================

  /**
   * Infer desires from observations and beliefs
   */
  inferDesiresFromObservation(content: string, concepts: string[]): UserDesire[] {
    const desires: UserDesire[] = [];

    // Look for explicit goal statements
    const goalPatterns = [
      /\bwant to\s+(.+?)(?:[.!?]|$)/i,
      /\bneed to\s+(.+?)(?:[.!?]|$)/i,
      /\bshould\s+(.+?)(?:[.!?]|$)/i,
      /\bgoing to\s+(.+?)(?:[.!?]|$)/i,
    ];

    for (const pattern of goalPatterns) {
      const match = content.match(pattern);
      if (match) {
        const desireId = this.generateId(`desire:${match[1].substring(0, 50)}`);

        this.db.prepare(`
          INSERT INTO user_desires (id, desire_type, description, priority, related_concepts)
          VALUES (?, 'goal', ?, 5, ?)
          ON CONFLICT(id) DO UPDATE SET updated_at = datetime('now')
        `).run(desireId, match[1].trim(), JSON.stringify(concepts));

        desires.push({
          id: desireId,
          type: 'goal',
          description: match[1].trim(),
          priority: 5,
          timeframe: 'short-term',
          status: 'active',
          relatedConcepts: concepts,
        });
      }
    }

    // Infer implicit desires from high-interest concepts
    const highInterestBeliefs = this.getBeliefs('interest').filter(b => b.confidence > 0.6);
    for (const belief of highInterestBeliefs.slice(0, 3)) {
      const desireId = this.generateId(`desire:learn:${belief.object}`);

      const existing = this.db.prepare(`SELECT id FROM user_desires WHERE id = ?`).get(desireId);
      if (!existing) {
        this.db.prepare(`
          INSERT INTO user_desires (id, desire_type, description, priority, timeframe, related_concepts)
          VALUES (?, 'aspiration', ?, 3, 'ongoing', ?)
        `).run(desireId, `Learn more about ${belief.object}`, JSON.stringify([belief.object]));

        desires.push({
          id: desireId,
          type: 'aspiration',
          description: `Learn more about ${belief.object}`,
          priority: 3,
          timeframe: 'ongoing',
          status: 'active',
          relatedConcepts: [belief.object],
        });
      }
    }

    this.emit('desires_updated', { desires });
    return desires;
  }

  /**
   * Get current desires
   */
  getDesires(status?: string): UserDesire[] {
    let query = 'SELECT * FROM user_desires WHERE user_id = ?';
    const params: any[] = [this.userId];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY priority DESC LIMIT 20';

    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map(row => ({
      id: row.id,
      type: row.desire_type,
      description: row.description,
      priority: row.priority,
      timeframe: row.timeframe,
      status: row.status,
      relatedConcepts: JSON.parse(row.related_concepts || '[]'),
    }));
  }

  // ==========================================================================
  // DRIVES
  // ==========================================================================

  /**
   * Get current drive states
   */
  getDrives(): Drive[] {
    const rows = this.db.prepare(`
      SELECT * FROM drives ORDER BY level DESC
    `).all() as any[];

    return rows.map(row => ({
      type: row.drive_type as DriveType,
      level: row.level,
      baselineLevel: row.baseline_level,
      satisfactionThreshold: row.satisfaction_threshold,
      lastSatisfied: row.last_satisfied ? new Date(row.last_satisfied) : undefined,
    }));
  }

  /**
   * Get urgent drives (above threshold)
   */
  getUrgentDrives(): Drive[] {
    return this.getDrives().filter(d => d.level >= d.satisfactionThreshold);
  }

  /**
   * Accumulate drive based on activity
   */
  accumulateDrive(driveType: DriveType, amount: number, trigger: string): void {
    const drive = this.db.prepare(`SELECT * FROM drives WHERE drive_type = ?`).get(driveType) as any;
    if (!drive) return;

    const newLevel = Math.min(100, drive.level + amount);

    this.db.prepare(`
      UPDATE drives SET level = ?, updated_at = datetime('now') WHERE drive_type = ?
    `).run(newLevel, driveType);

    this.emit('drive_accumulated', { driveType, amount, newLevel, trigger });
  }

  /**
   * Satisfy a drive (after completing relevant activity)
   */
  satisfyDrive(driveType: DriveType, effectiveness: number): void {
    const drive = this.db.prepare(`SELECT * FROM drives WHERE drive_type = ?`).get(driveType) as any;
    if (!drive) return;

    const reduction = drive.level * effectiveness;
    const newLevel = Math.max(drive.baseline_level, drive.level - reduction);

    this.db.prepare(`
      UPDATE drives SET level = ?, last_satisfied = datetime('now'), updated_at = datetime('now')
      WHERE drive_type = ?
    `).run(newLevel, driveType);

    this.emit('drive_satisfied', { driveType, effectiveness, newLevel });
  }

  /**
   * Update drives based on observation (research satisfies curiosity, etc.)
   */
  updateDrivesFromActivity(activity: 'research' | 'complete_task' | 'new_topic' | 'break'): void {
    switch (activity) {
      case 'research':
        this.satisfyDrive('curiosity', 0.3);
        this.accumulateDrive('completion', 2, 'pending_research');
        break;
      case 'complete_task':
        this.satisfyDrive('completion', 0.5);
        this.satisfyDrive('mastery', 0.2);
        break;
      case 'new_topic':
        this.satisfyDrive('novelty', 0.4);
        this.accumulateDrive('curiosity', 5, 'new_topic');
        break;
      case 'break':
        this.satisfyDrive('rest', 0.6);
        break;
    }
  }

  // ==========================================================================
  // ATTENTION
  // ==========================================================================

  /**
   * Record an attention event
   */
  recordAttentionEvent(eventType: string, context?: string, durationMs?: number): void {
    const id = this.generateId();

    this.db.prepare(`
      INSERT INTO attention_events (id, user_id, timestamp, event_type, context, duration_ms)
      VALUES (?, ?, datetime('now'), ?, ?, ?)
    `).run(id, this.userId, eventType, context || null, durationMs || null);
  }

  /**
   * Get current attention state (simplified inference)
   */
  getAttentionState(): AttentionSnapshot {
    // Get recent events (last 15 minutes)
    const events = this.db.prepare(`
      SELECT * FROM attention_events
      WHERE user_id = ? AND timestamp > datetime('now', '-15 minutes')
      ORDER BY timestamp DESC
    `).all(this.userId) as any[];

    // Calculate metrics
    const switchEvents = events.filter(e => e.event_type === 'context_switch');
    const switchFrequency = switchEvents.length / 15; // per minute

    // Classify state based on patterns
    let state: AttentionState = 'unknown';
    let confidence = 0.5;

    if (events.length < 2) {
      state = 'unknown';
      confidence = 0.3;
    } else if (switchFrequency > 10) {
      state = 'crashed';
      confidence = 0.8;
    } else if (switchFrequency > 5) {
      state = 'scattered';
      confidence = 0.7;
    } else if (switchFrequency < 1) {
      // Check for hyperfocus (long single-context dwell)
      const lastEvent = events[0];
      if (lastEvent?.duration_ms > 30 * 60 * 1000) {
        state = 'hyperfocus';
        confidence = 0.7;
      } else {
        state = 'focused';
        confidence = 0.6;
      }
    } else {
      state = 'focused';
      confidence = 0.5;
    }

    const focusScore = Math.max(0, 1 - (switchFrequency / 10));

    const cognitiveLoad: AttentionSnapshot['cognitiveLoad'] =
      switchFrequency > 10 ? 'overload' :
      switchFrequency > 5 ? 'high' :
      switchFrequency > 2 ? 'medium' : 'low';

    // Store snapshot
    this.db.prepare(`
      INSERT INTO attention_states (user_id, state, confidence, cognitive_load, switch_frequency, focus_score)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(this.userId, state, confidence, cognitiveLoad, switchFrequency, focusScore);

    const snapshot: AttentionSnapshot = {
      state,
      confidence,
      cognitiveLoad,
      switchFrequency,
      focusScore,
    };

    this.emit('attention_updated', snapshot);
    return snapshot;
  }

  // ==========================================================================
  // INFERRED NEEDS (combining BDI + Drives + Attention)
  // ==========================================================================

  /**
   * Infer what the user might need right now
   */
  inferNeeds(): InferredNeed[] {
    const needs: InferredNeed[] = [];
    const attention = this.getAttentionState();
    const urgentDrives = this.getUrgentDrives();
    const activeDesires = this.getDesires('active');

    // Attention-based needs
    if (attention.state === 'crashed') {
      needs.push({
        id: this.generateId(),
        type: 'support',
        description: 'You seem to be having trouble focusing. Would you like to take a short break or try a different approach?',
        confidence: attention.confidence,
        urgency: 'immediate',
        suggestedAction: 'take_break',
      });
    }

    if (attention.state === 'hyperfocus') {
      needs.push({
        id: this.generateId(),
        type: 'reminder',
        description: "You've been focused for a while. Consider taking a break to maintain energy.",
        confidence: attention.confidence,
        urgency: 'soon',
        suggestedAction: 'schedule_break',
      });
    }

    // Drive-based needs
    for (const drive of urgentDrives) {
      switch (drive.type) {
        case 'curiosity':
          needs.push({
            id: this.generateId(),
            type: 'information',
            description: 'Your curiosity drive is high. Would you like me to research something interesting?',
            confidence: 0.7,
            urgency: 'soon',
            suggestedAction: 'research',
          });
          break;

        case 'completion':
          needs.push({
            id: this.generateId(),
            type: 'reminder',
            description: 'You have unfinished tasks building up. Consider completing one to build momentum.',
            confidence: 0.6,
            urgency: 'soon',
            suggestedAction: 'complete_task',
          });
          break;

        case 'novelty':
          needs.push({
            id: this.generateId(),
            type: 'guidance',
            description: "You might benefit from exploring something new. I can suggest some interesting topics.",
            confidence: 0.5,
            urgency: 'background',
            suggestedAction: 'explore_new',
          });
          break;
      }
    }

    // Desire-based needs
    for (const desire of activeDesires.slice(0, 2)) {
      needs.push({
        id: this.generateId(),
        type: 'guidance',
        description: `You wanted to: ${desire.description}`,
        confidence: 0.4,
        urgency: desire.timeframe === 'immediate' ? 'immediate' : 'background',
        suggestedAction: 'work_on_goal',
      });
    }

    return needs.sort((a, b) => {
      const urgencyOrder = { immediate: 0, soon: 1, background: 2 };
      return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
    });
  }

  // ==========================================================================
  // VALUE EVALUATION (for rabbit hole prioritization)
  // ==========================================================================

  /**
   * Evaluate the value of researching a topic based on BDI + Drives
   */
  evaluateTopicValue(topic: string, concepts: string[]): { value: number; reasoning: string[] } {
    const reasoning: string[] = [];
    let value = 0.3; // Base value

    // Check if topic aligns with beliefs (interests)
    const interests = this.getBeliefs('interest');
    for (const belief of interests) {
      if (concepts.some(c => c.toLowerCase().includes(belief.object.toLowerCase()))) {
        value += belief.confidence * 0.2;
        reasoning.push(`Aligns with interest in ${belief.object} (+${(belief.confidence * 0.2).toFixed(2)})`);
      }
    }

    // Check if topic relates to active desires
    const desires = this.getDesires('active');
    for (const desire of desires) {
      if (desire.relatedConcepts.some(c => concepts.includes(c))) {
        value += 0.15 * (desire.priority / 10);
        reasoning.push(`Related to goal: ${desire.description.substring(0, 30)}...`);
      }
    }

    // Check drive states
    const drives = this.getDrives();
    const curiosityDrive = drives.find(d => d.type === 'curiosity');
    if (curiosityDrive && curiosityDrive.level > 60) {
      value += 0.1;
      reasoning.push('Curiosity drive is high (+0.10)');
    }

    const noveltyDrive = drives.find(d => d.type === 'novelty');
    if (noveltyDrive && noveltyDrive.level > 60) {
      value += 0.1;
      reasoning.push('Novelty drive is high (+0.10)');
    }

    return {
      value: Math.min(1, value),
      reasoning,
    };
  }

  // ==========================================================================
  // UTILITIES
  // ==========================================================================

  private generateId(seed?: string): string {
    if (seed) {
      // Deterministic ID for deduplication
      let hash = 0;
      for (let i = 0; i < seed.length; i++) {
        const char = seed.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      return Math.abs(hash).toString(36);
    }
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
