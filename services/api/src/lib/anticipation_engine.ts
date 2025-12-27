/**
 * Anticipation Engine for Ronald-GI
 *
 * Based on Google's Sensible Agent research which showed proactive AI
 * reduced cognitive workload from 65 to 21 on a 100-point scale.
 *
 * Key principles:
 * 1. Anticipate needs before the user asks
 * 2. Pre-fetch and pre-compute likely next actions
 * 3. Surface relevant context automatically
 * 4. Reduce decision fatigue through smart prioritization
 *
 * Designed for INTJ/ADHD minds:
 * - Non-intrusive (context-aware timing)
 * - Memory augmentation (what you looked at but forgot)
 * - Transition support (helps context switching)
 * - Focus protection (batches non-urgent items)
 */

import Database from 'better-sqlite3';
import { MemoryManager } from './memory_layer';

// ============================================
// TYPES
// ============================================

export interface AnticipatedNeed {
  id: string;
  type: 'research' | 'reminder' | 'context' | 'action' | 'connection';
  title: string;
  description: string;
  relevance: number; // 0-1
  urgency: 'immediate' | 'soon' | 'later' | 'background';
  confidence: number; // 0-1
  evidence: string[];
  suggestedAction?: string;
  relatedItems?: string[];
  createdAt: string;
}

export interface UserContext {
  currentActivity: string;
  recentConcepts: string[];
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  dayOfWeek: number;
  focusLevel: 'deep' | 'normal' | 'scattered';
  lastInteractionMinutes: number;
}

export interface AnticipationResult {
  needs: AnticipatedNeed[];
  shouldInterrupt: boolean;
  interruptReason?: string;
  batchedForLater: AnticipatedNeed[];
  contextSummary: string;
}

export interface BehaviorPattern {
  id: string;
  pattern: string;
  frequency: number;
  lastSeen: string;
  predictedNext?: string;
  confidence: number;
}

// ============================================
// BEHAVIOR TRACKER
// ============================================

export class BehaviorTracker {
  constructor(private db: Database.Database) {
    this.ensureTables();
  }

  private ensureTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS behavior_sequences (
        id TEXT PRIMARY KEY,
        user_id TEXT DEFAULT 'default',
        sequence_json TEXT NOT NULL,
        frequency INTEGER DEFAULT 1,
        last_seen TEXT DEFAULT (datetime('now')),
        predicted_next TEXT,
        confidence REAL DEFAULT 0.5
      );

      CREATE TABLE IF NOT EXISTS context_transitions (
        id TEXT PRIMARY KEY,
        from_context TEXT NOT NULL,
        to_context TEXT NOT NULL,
        frequency INTEGER DEFAULT 1,
        avg_duration_minutes REAL,
        common_triggers TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_behaviors_user ON behavior_sequences(user_id);
      CREATE INDEX IF NOT EXISTS idx_transitions_from ON context_transitions(from_context);
    `);
  }

  /**
   * Record a user action for pattern learning
   */
  recordAction(userId: string, action: string, context: string): void {
    // Get recent actions
    const recentKey = `recent_actions:${userId}`;
    const recent = this.getRecentActions(userId);
    recent.push({ action, context, timestamp: Date.now() });

    // Keep only last 20 actions
    const trimmed = recent.slice(-20);

    // Store updated sequence
    this.db.prepare(`
      INSERT INTO behavior_sequences (id, user_id, sequence_json, last_seen)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        sequence_json = excluded.sequence_json,
        last_seen = datetime('now'),
        frequency = frequency + 1
    `).run(recentKey, userId, JSON.stringify(trimmed));

    // Detect patterns
    this.detectPatterns(userId, trimmed);
  }

  private getRecentActions(userId: string): Array<{ action: string; context: string; timestamp: number }> {
    try {
      const row = this.db.prepare(
        'SELECT sequence_json FROM behavior_sequences WHERE id = ?'
      ).get(`recent_actions:${userId}`) as { sequence_json: string } | undefined;
      return row ? JSON.parse(row.sequence_json) : [];
    } catch {
      return [];
    }
  }

  /**
   * Detect repeating patterns in user behavior
   */
  private detectPatterns(userId: string, actions: Array<{ action: string; context: string }>): void {
    // Look for 2-grams and 3-grams
    for (const n of [2, 3]) {
      if (actions.length < n) continue;

      const ngrams = new Map<string, number>();
      for (let i = 0; i <= actions.length - n; i++) {
        const gram = actions.slice(i, i + n).map(a => a.action).join('→');
        ngrams.set(gram, (ngrams.get(gram) || 0) + 1);
      }

      // Store patterns that occur 2+ times
      for (const [pattern, count] of ngrams) {
        if (count >= 2) {
          const patternId = `pattern:${userId}:${pattern}`;
          const parts = pattern.split('→');
          const predictedNext = this.predictNextAction(userId, parts);

          this.db.prepare(`
            INSERT INTO behavior_sequences (id, user_id, sequence_json, frequency, predicted_next, confidence)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              frequency = behavior_sequences.frequency + 1,
              last_seen = datetime('now'),
              predicted_next = excluded.predicted_next,
              confidence = MIN(0.95, behavior_sequences.confidence + 0.05)
          `).run(patternId, userId, JSON.stringify(parts), count, predictedNext, 0.3 + count * 0.1);
        }
      }
    }
  }

  private predictNextAction(userId: string, sequence: string[]): string | null {
    // Find what usually comes after this sequence
    const patterns = this.db.prepare(`
      SELECT sequence_json, frequency
      FROM behavior_sequences
      WHERE user_id = ? AND id LIKE 'pattern:%'
      ORDER BY frequency DESC
      LIMIT 50
    `).all(userId) as any[];

    for (const p of patterns) {
      const seq = JSON.parse(p.sequence_json);
      // Check if our sequence is a prefix
      if (seq.length > sequence.length) {
        const matches = sequence.every((s, i) => seq[i] === s);
        if (matches) {
          return seq[sequence.length];
        }
      }
    }
    return null;
  }

  /**
   * Predict what the user will do next
   */
  predictNext(userId: string, currentAction: string): { action: string; confidence: number } | null {
    // Find patterns ending with current action
    const patterns = this.db.prepare(`
      SELECT sequence_json, predicted_next, confidence
      FROM behavior_sequences
      WHERE user_id = ?
        AND predicted_next IS NOT NULL
        AND sequence_json LIKE ?
      ORDER BY confidence DESC
      LIMIT 5
    `).all(userId, `%"${currentAction}"]`) as any[];

    if (patterns.length > 0 && patterns[0].predicted_next) {
      return {
        action: patterns[0].predicted_next,
        confidence: patterns[0].confidence,
      };
    }
    return null;
  }

  /**
   * Record context transition
   */
  recordTransition(fromContext: string, toContext: string, durationMinutes: number): void {
    const transitionId = `${fromContext}→${toContext}`;

    this.db.prepare(`
      INSERT INTO context_transitions (id, from_context, to_context, frequency, avg_duration_minutes)
      VALUES (?, ?, ?, 1, ?)
      ON CONFLICT(id) DO UPDATE SET
        frequency = frequency + 1,
        avg_duration_minutes = (avg_duration_minutes * frequency + ?) / (frequency + 1)
    `).run(transitionId, fromContext, toContext, durationMinutes, durationMinutes);
  }

  /**
   * Get likely next contexts
   */
  getLikelyNextContexts(currentContext: string): Array<{ context: string; probability: number }> {
    const transitions = this.db.prepare(`
      SELECT to_context, frequency
      FROM context_transitions
      WHERE from_context = ?
      ORDER BY frequency DESC
      LIMIT 5
    `).all(currentContext) as any[];

    const total = transitions.reduce((sum, t) => sum + t.frequency, 0);
    return transitions.map(t => ({
      context: t.to_context,
      probability: t.frequency / total,
    }));
  }
}

// ============================================
// ANTICIPATION ENGINE
// ============================================

export class AnticipationEngine {
  private behaviorTracker: BehaviorTracker;
  private memoryManager: MemoryManager | null = null;

  constructor(private db: Database.Database) {
    this.behaviorTracker = new BehaviorTracker(db);
  }

  /**
   * Connect to the memory layer for richer anticipation
   */
  setMemoryManager(mm: MemoryManager): void {
    this.memoryManager = mm;
  }

  /**
   * Anticipate user needs based on current context
   */
  anticipate(userId: string, context: UserContext): AnticipationResult {
    const needs: AnticipatedNeed[] = [];
    const batchedForLater: AnticipatedNeed[] = [];

    // 1. Behavior-based predictions
    const behaviorNeeds = this.anticipateFromBehavior(userId, context);
    needs.push(...behaviorNeeds);

    // 2. Context-based anticipations
    const contextNeeds = this.anticipateFromContext(context);
    needs.push(...contextNeeds);

    // 3. Time-based anticipations
    const timeNeeds = this.anticipateFromTime(context);
    needs.push(...timeNeeds);

    // 4. Memory-based reminders
    if (this.memoryManager) {
      const memoryNeeds = this.anticipateFromMemory(userId, context);
      needs.push(...memoryNeeds);
    }

    // 5. Staleness checks
    const stalenessNeeds = this.anticipateFromStaleness(userId);
    needs.push(...stalenessNeeds);

    // Sort by relevance * urgency weight
    const urgencyWeight = {
      immediate: 4,
      soon: 2,
      later: 1,
      background: 0.5,
    };

    needs.sort((a, b) =>
      (b.relevance * urgencyWeight[b.urgency]) -
      (a.relevance * urgencyWeight[a.urgency])
    );

    // Decide what to batch vs interrupt
    const shouldInterrupt = this.shouldInterrupt(context, needs);
    let interruptReason: string | undefined;

    if (shouldInterrupt) {
      const urgent = needs.filter(n => n.urgency === 'immediate');
      if (urgent.length > 0) {
        interruptReason = urgent[0].title;
      }
    }

    // Batch non-urgent items when user is in deep focus
    if (context.focusLevel === 'deep') {
      const toBatch = needs.filter(n =>
        n.urgency !== 'immediate' && n.relevance < 0.8
      );
      batchedForLater.push(...toBatch);
      needs.splice(0, needs.length, ...needs.filter(n =>
        n.urgency === 'immediate' || n.relevance >= 0.8
      ));
    }

    return {
      needs: needs.slice(0, 5), // Top 5 for now
      shouldInterrupt,
      interruptReason,
      batchedForLater,
      contextSummary: this.generateContextSummary(context, needs),
    };
  }

  private anticipateFromBehavior(userId: string, context: UserContext): AnticipatedNeed[] {
    const needs: AnticipatedNeed[] = [];

    // Predict next action
    if (context.currentActivity) {
      const prediction = this.behaviorTracker.predictNext(userId, context.currentActivity);
      if (prediction && prediction.confidence > 0.5) {
        needs.push({
          id: this.randomId(),
          type: 'action',
          title: `Ready for: ${prediction.action}`,
          description: `Based on your patterns, you usually do "${prediction.action}" next`,
          relevance: prediction.confidence,
          urgency: 'soon',
          confidence: prediction.confidence,
          evidence: ['Behavior pattern detected'],
          suggestedAction: prediction.action,
          createdAt: new Date().toISOString(),
        });
      }
    }

    // Context transition prediction
    const likelyContexts = this.behaviorTracker.getLikelyNextContexts(context.currentActivity);
    if (likelyContexts.length > 0 && likelyContexts[0].probability > 0.4) {
      const next = likelyContexts[0];
      needs.push({
        id: this.randomId(),
        type: 'context',
        title: `Preparing for: ${next.context}`,
        description: `You often switch to ${next.context} from here`,
        relevance: next.probability,
        urgency: 'later',
        confidence: next.probability,
        evidence: ['Context transition pattern'],
        createdAt: new Date().toISOString(),
      });
    }

    return needs;
  }

  private anticipateFromContext(context: UserContext): AnticipatedNeed[] {
    const needs: AnticipatedNeed[] = [];

    // If user has been away, surface what they were working on
    if (context.lastInteractionMinutes > 30) {
      needs.push({
        id: this.randomId(),
        type: 'reminder',
        title: 'Welcome back',
        description: `You were working on: ${context.currentActivity || 'research'}`,
        relevance: 0.7,
        urgency: 'soon',
        confidence: 0.8,
        evidence: ['Session gap detected'],
        relatedItems: context.recentConcepts,
        createdAt: new Date().toISOString(),
      });
    }

    // If focus is scattered, suggest consolidation
    if (context.focusLevel === 'scattered' && context.recentConcepts.length > 5) {
      needs.push({
        id: this.randomId(),
        type: 'action',
        title: 'Focus opportunity',
        description: `You're exploring ${context.recentConcepts.length} topics. Want to focus on one?`,
        relevance: 0.6,
        urgency: 'later',
        confidence: 0.7,
        evidence: ['Multiple topic switches detected'],
        suggestedAction: 'Create research plan for top topic',
        relatedItems: context.recentConcepts.slice(0, 3),
        createdAt: new Date().toISOString(),
      });
    }

    return needs;
  }

  private anticipateFromTime(context: UserContext): AnticipatedNeed[] {
    const needs: AnticipatedNeed[] = [];

    // Morning briefing
    if (context.timeOfDay === 'morning') {
      needs.push({
        id: this.randomId(),
        type: 'context',
        title: 'Daily briefing ready',
        description: 'See what Ronald learned overnight',
        relevance: 0.8,
        urgency: 'soon',
        confidence: 0.9,
        evidence: ['Morning routine'],
        suggestedAction: 'View daily briefing',
        createdAt: new Date().toISOString(),
      });
    }

    // End of day summary
    if (context.timeOfDay === 'evening') {
      needs.push({
        id: this.randomId(),
        type: 'action',
        title: 'Plan tomorrow',
        description: 'Set research priorities for overnight processing',
        relevance: 0.6,
        urgency: 'later',
        confidence: 0.85,
        evidence: ['Evening wrap-up'],
        suggestedAction: 'Review and prioritize pending research',
        createdAt: new Date().toISOString(),
      });
    }

    // Weekend pattern
    if (context.dayOfWeek === 0 || context.dayOfWeek === 6) {
      needs.push({
        id: this.randomId(),
        type: 'research',
        title: 'Weekend deep dive available',
        description: 'More time for in-depth exploration today',
        relevance: 0.5,
        urgency: 'background',
        confidence: 0.7,
        evidence: ['Weekend detected'],
        createdAt: new Date().toISOString(),
      });
    }

    return needs;
  }

  private anticipateFromMemory(userId: string, context: UserContext): AnticipatedNeed[] {
    const needs: AnticipatedNeed[] = [];

    if (!this.memoryManager) return needs;

    const focus = this.memoryManager.getUserFocus(userId);

    // Remind about forgotten interests
    if (focus.concepts.length > 0) {
      const forgottenConcepts = focus.concepts.filter(
        c => !context.recentConcepts.includes(c)
      );

      if (forgottenConcepts.length > 0) {
        needs.push({
          id: this.randomId(),
          type: 'reminder',
          title: 'Previously interested in...',
          description: forgottenConcepts.slice(0, 3).join(', '),
          relevance: 0.5,
          urgency: 'background',
          confidence: 0.6,
          evidence: ['Interest history'],
          relatedItems: forgottenConcepts,
          createdAt: new Date().toISOString(),
        });
      }
    }

    // Surface connections between current and past interests
    const currentTopics = context.recentConcepts.slice(0, 2);
    const pastTopics = focus.concepts.slice(0, 5);

    for (const current of currentTopics) {
      for (const past of pastTopics) {
        if (current !== past) {
          const graph = this.memoryManager.getGraphStore();
          const paths = graph.findPaths(current, past, 3);
          if (paths.length > 0) {
            needs.push({
              id: this.randomId(),
              type: 'connection',
              title: `Connection: ${current} ↔ ${past}`,
              description: `These topics are related through your research`,
              relevance: 0.7,
              urgency: 'later',
              confidence: 0.65,
              evidence: ['Graph path found'],
              relatedItems: paths[0],
              createdAt: new Date().toISOString(),
            });
            break;
          }
        }
      }
    }

    return needs;
  }

  private anticipateFromStaleness(userId: string): AnticipatedNeed[] {
    const needs: AnticipatedNeed[] = [];

    try {
      // Check for stale high-weight concepts
      const stale = this.db.prepare(`
        SELECT c.label, pw.weight, pw.last_engagement_at,
               julianday('now') - julianday(pw.last_engagement_at) as days_stale
        FROM preference_weights pw
        JOIN concepts c ON pw.target_id = c.id
        WHERE pw.weight_type = 'concept'
          AND pw.weight > 1.2
          AND pw.last_engagement_at < datetime('now', '-7 days')
        ORDER BY pw.weight DESC
        LIMIT 3
      `).all() as any[];

      for (const s of stale) {
        needs.push({
          id: this.randomId(),
          type: 'reminder',
          title: `Still interested in ${s.label}?`,
          description: `High interest but no activity in ${Math.round(s.days_stale)} days`,
          relevance: 0.5,
          urgency: 'background',
          confidence: 0.7,
          evidence: [`Weight: ${s.weight.toFixed(2)}`, `Days stale: ${Math.round(s.days_stale)}`],
          suggestedAction: 'Research latest developments',
          createdAt: new Date().toISOString(),
        });
      }

      // Check for sources saved but not read
      const unread = this.db.prepare(`
        SELECT s.title, s.priority, s.discovered_via
        FROM sources s
        WHERE s.processed_at IS NULL
          AND s.priority >= 8
          AND s.created_at < datetime('now', '-3 days')
        ORDER BY s.priority DESC
        LIMIT 3
      `).all() as any[];

      if (unread.length > 0) {
        needs.push({
          id: this.randomId(),
          type: 'action',
          title: `${unread.length} high-priority sources unread`,
          description: unread.map(u => u.title).join(', ').substring(0, 100),
          relevance: 0.6,
          urgency: 'soon',
          confidence: 0.9,
          evidence: ['Source queue'],
          suggestedAction: 'Process reading queue',
          createdAt: new Date().toISOString(),
        });
      }
    } catch {}

    return needs;
  }

  private shouldInterrupt(context: UserContext, needs: AnticipatedNeed[]): boolean {
    // Never interrupt in deep focus unless truly urgent
    if (context.focusLevel === 'deep') {
      return needs.some(n => n.urgency === 'immediate' && n.relevance > 0.9);
    }

    // Don't interrupt if just started (< 5 min)
    if (context.lastInteractionMinutes < 5) {
      return false;
    }

    // Interrupt for high-confidence immediate needs
    return needs.some(n =>
      n.urgency === 'immediate' &&
      n.confidence > 0.7 &&
      n.relevance > 0.7
    );
  }

  private generateContextSummary(context: UserContext, needs: AnticipatedNeed[]): string {
    const parts: string[] = [];

    if (context.currentActivity) {
      parts.push(`Working on: ${context.currentActivity}`);
    }

    if (context.recentConcepts.length > 0) {
      parts.push(`Exploring: ${context.recentConcepts.slice(0, 3).join(', ')}`);
    }

    const immediateCount = needs.filter(n => n.urgency === 'immediate').length;
    if (immediateCount > 0) {
      parts.push(`${immediateCount} items need attention`);
    }

    return parts.join(' | ');
  }

  /**
   * Record that an anticipation was acted upon (for learning)
   */
  recordAnticipationOutcome(userId: string, needId: string, outcome: 'acted' | 'dismissed' | 'helpful'): void {
    // This could be used to improve anticipation accuracy over time
    this.behaviorTracker.recordAction(userId, `anticipation_${outcome}`, needId);
  }

  /**
   * Pre-fetch resources for anticipated needs
   */
  async prefetchForAnticipation(needs: AnticipatedNeed[]): Promise<void> {
    // Queue research jobs for high-confidence anticipations
    for (const need of needs) {
      if (need.type === 'research' && need.confidence > 0.7) {
        try {
          this.db.prepare(`
            INSERT OR IGNORE INTO job_queue (id, job_type, priority, payload_json)
            VALUES (?, 'prefetch', ?, ?)
          `).run(
            `prefetch_${need.id}`,
            Math.round(need.relevance * 10),
            JSON.stringify({ topic: need.title, anticipated: true })
          );
        } catch {}
      }
    }
  }

  private randomId(): string {
    return Math.random().toString(36).substring(2, 15);
  }
}

// ============================================
// FACTORY
// ============================================

export function createAnticipationEngine(db: Database.Database): AnticipationEngine {
  return new AnticipationEngine(db);
}
