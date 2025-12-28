/**
 * Heartbeat Worker for Ronald-GI
 *
 * Inspired by QuixiAI's AGI Memory heartbeat system.
 *
 * The heartbeat is periodic background processing that enables
 * proactive assistance. Each heartbeat is a "moment of awareness"
 * where the system:
 *
 * 1. Observes current state (attention, drives, pending tasks)
 * 2. Applies maintenance (memory decay, drive updates)
 * 3. Decides on proactive actions (nudges, reminders)
 * 4. Records the observation as experience
 *
 * Unlike AGI Memory's full autonomy, Ronald-GI's heartbeat is
 * focused on ADHD assistance: catching scattered states early,
 * nudging before crashes, and celebrating completions.
 */

import type { Database } from 'better-sqlite3';
import { MemoryDecayManager } from './memory_decay';
import { DrivesManager } from './drives';
import { WorkingMemory } from './working_memory';
import type { AttentionState } from './attention_inference';

// ============================================
// TYPES
// ============================================

export interface HeartbeatConfig {
  intervalMs: number;           // How often to run (default: 15 min)
  enabled: boolean;             // Master switch
  quietHoursStart?: number;     // Hour to stop (e.g., 22 for 10 PM)
  quietHoursEnd?: number;       // Hour to resume (e.g., 8 for 8 AM)
  energyBudget: number;         // Max "energy" per heartbeat (limits actions)
}

export interface HeartbeatObservation {
  id: string;
  timestamp: Date;
  attentionState?: AttentionState;
  urgentDrives: string[];
  pendingTasks: number;
  workingMemorySize: number;
  decayResults: {
    beliefsDecayed: number;
    patternsDecayed: number;
    rulesDecayed: number;
  };
  actionsProposed: HeartbeatAction[];
  actionsExecuted: HeartbeatAction[];
  energyUsed: number;
}

export interface HeartbeatAction {
  type: 'nudge' | 'reminder' | 'celebration' | 'suggestion' | 'cleanup';
  description: string;
  energyCost: number;
  priority: number;
  executed: boolean;
  result?: string;
}

export type HeartbeatEventType =
  | 'started'
  | 'completed'
  | 'skipped'
  | 'error'
  | 'action_executed';

// ============================================
// DEFAULT CONFIGURATION
// ============================================

const DEFAULT_CONFIG: HeartbeatConfig = {
  intervalMs: 15 * 60 * 1000,  // 15 minutes
  enabled: true,
  quietHoursStart: 22,          // 10 PM
  quietHoursEnd: 8,             // 8 AM
  energyBudget: 10,             // Can do ~2-3 actions per heartbeat
};

// ============================================
// ACTION COSTS
// ============================================

const ACTION_COSTS: Record<HeartbeatAction['type'], number> = {
  nudge: 3,
  reminder: 2,
  celebration: 1,
  suggestion: 4,
  cleanup: 1,
};

// ============================================
// HEARTBEAT WORKER
// ============================================

export class HeartbeatWorker {
  private config: HeartbeatConfig;
  private timer?: NodeJS.Timeout;
  private isRunning: boolean = false;
  private lastHeartbeat?: Date;

  private decayManager: MemoryDecayManager;
  private drivesManager: DrivesManager;
  private workingMemory: WorkingMemory;

  constructor(
    private db: Database,
    config?: Partial<HeartbeatConfig>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.decayManager = new MemoryDecayManager(db);
    this.drivesManager = new DrivesManager(db);
    this.workingMemory = new WorkingMemory(db);
  }

  /**
   * Start the heartbeat worker
   */
  start(): void {
    if (this.timer) return;

    this.timer = setInterval(() => {
      this.beat().catch(err => {
        this.logEvent('error', { error: err.message });
      });
    }, this.config.intervalMs);

    this.logEvent('started', {});

    // Run immediately on start
    this.beat().catch(err => {
      this.logEvent('error', { error: err.message });
    });
  }

  /**
   * Stop the heartbeat worker
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * Check if currently in quiet hours
   */
  private isQuietHours(): boolean {
    if (!this.config.quietHoursStart || !this.config.quietHoursEnd) {
      return false;
    }

    const hour = new Date().getHours();

    if (this.config.quietHoursStart < this.config.quietHoursEnd) {
      // Quiet hours don't span midnight
      return hour >= this.config.quietHoursStart && hour < this.config.quietHoursEnd;
    } else {
      // Quiet hours span midnight (e.g., 22:00 - 08:00)
      return hour >= this.config.quietHoursStart || hour < this.config.quietHoursEnd;
    }
  }

  /**
   * Execute a single heartbeat
   */
  async beat(): Promise<HeartbeatObservation | null> {
    if (!this.config.enabled) {
      this.logEvent('skipped', { reason: 'disabled' });
      return null;
    }

    if (this.isQuietHours()) {
      this.logEvent('skipped', { reason: 'quiet_hours' });
      return null;
    }

    if (this.isRunning) {
      this.logEvent('skipped', { reason: 'already_running' });
      return null;
    }

    this.isRunning = true;

    try {
      const observation = await this.executeHeartbeat();
      this.lastHeartbeat = new Date();
      this.logEvent('completed', { observation });
      return observation;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Execute the heartbeat logic
   */
  private async executeHeartbeat(): Promise<HeartbeatObservation> {
    const id = `hb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = new Date();
    let energyUsed = 0;

    // 1. Apply memory decay
    const decayResults = this.decayManager.runDecayCycle();

    // 2. Apply drive decay
    this.drivesManager.applyDecay();

    // 3. Clean up working memory
    this.workingMemory.cleanup();

    // 4. Gather observations
    const urgentDrives = this.drivesManager.getUrgentDrives().map(d => d.type);
    const pendingActions = this.workingMemory.getPendingActions();
    const wmStats = this.workingMemory.getStats();

    // 5. Propose actions based on observations
    const proposedActions = this.proposeActions(urgentDrives, pendingActions.length);

    // 6. Execute actions within energy budget
    const executedActions: HeartbeatAction[] = [];

    for (const action of proposedActions) {
      if (energyUsed + action.energyCost <= this.config.energyBudget) {
        const result = await this.executeAction(action);
        action.executed = true;
        action.result = result;
        executedActions.push(action);
        energyUsed += action.energyCost;
      }
    }

    // 7. Record observation
    const observation: HeartbeatObservation = {
      id,
      timestamp,
      urgentDrives,
      pendingTasks: pendingActions.length,
      workingMemorySize: wmStats.total,
      decayResults: {
        beliefsDecayed: decayResults.beliefs.length,
        patternsDecayed: decayResults.patterns.length,
        rulesDecayed: decayResults.rules.length,
      },
      actionsProposed: proposedActions,
      actionsExecuted: executedActions,
      energyUsed,
    };

    this.saveObservation(observation);

    return observation;
  }

  /**
   * Propose actions based on current state
   */
  private proposeActions(
    urgentDrives: string[],
    pendingTaskCount: number
  ): HeartbeatAction[] {
    const actions: HeartbeatAction[] = [];

    // Propose nudges for urgent drives
    for (const drive of urgentDrives.slice(0, 2)) {
      switch (drive) {
        case 'focus':
          actions.push({
            type: 'nudge',
            description: 'Your focus drive is high. Want to pick one thing to concentrate on?',
            energyCost: ACTION_COSTS.nudge,
            priority: 8,
            executed: false,
          });
          break;

        case 'rest':
          actions.push({
            type: 'nudge',
            description: 'You\'ve been going hard. Time for a short break?',
            energyCost: ACTION_COSTS.nudge,
            priority: 9,
            executed: false,
          });
          break;

        case 'novelty':
          actions.push({
            type: 'suggestion',
            description: 'Feeling stuck in routine? Here\'s something new to explore.',
            energyCost: ACTION_COSTS.suggestion,
            priority: 6,
            executed: false,
          });
          break;

        case 'completion':
          actions.push({
            type: 'reminder',
            description: `You have ${pendingTaskCount} things waiting. Want to knock one out?`,
            energyCost: ACTION_COSTS.reminder,
            priority: 7,
            executed: false,
          });
          break;
      }
    }

    // Always do cleanup
    actions.push({
      type: 'cleanup',
      description: 'Cleaning up expired memories and stale context',
      energyCost: ACTION_COSTS.cleanup,
      priority: 2,
      executed: false,
    });

    // Sort by priority
    return actions.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Execute a single action
   */
  private async executeAction(action: HeartbeatAction): Promise<string> {
    switch (action.type) {
      case 'cleanup':
        const cleaned = this.workingMemory.cleanup();
        return `Cleaned ${cleaned} expired items`;

      case 'nudge':
      case 'reminder':
      case 'celebration':
      case 'suggestion':
        // Store in working memory for retrieval by UI
        this.workingMemory.store({
          type: 'pending',
          content: JSON.stringify({
            actionType: action.type,
            message: action.description,
            timestamp: new Date().toISOString(),
          }),
          priority: action.priority,
          ttlSeconds: 3600, // 1 hour
          metadata: { source: 'heartbeat' },
        });
        return `Queued ${action.type} for delivery`;

      default:
        return 'Unknown action type';
    }
  }

  /**
   * Save observation to database
   */
  private saveObservation(observation: HeartbeatObservation): void {
    this.db.prepare(`
      INSERT INTO heartbeat_observations (
        id, timestamp, attention_state, urgent_drives_json,
        pending_tasks, working_memory_size, decay_results_json,
        actions_proposed_json, actions_executed_json, energy_used
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      observation.id,
      observation.timestamp.toISOString(),
      observation.attentionState || null,
      JSON.stringify(observation.urgentDrives),
      observation.pendingTasks,
      observation.workingMemorySize,
      JSON.stringify(observation.decayResults),
      JSON.stringify(observation.actionsProposed),
      JSON.stringify(observation.actionsExecuted),
      observation.energyUsed
    );
  }

  /**
   * Log heartbeat event
   */
  private logEvent(type: HeartbeatEventType, data: any): void {
    this.db.prepare(`
      INSERT INTO heartbeat_events (id, event_type, data_json, timestamp)
      VALUES (?, ?, ?, ?)
    `).run(
      `he_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      JSON.stringify(data),
      new Date().toISOString()
    );
  }

  /**
   * Get recent observations
   */
  getRecentObservations(limit: number = 10): HeartbeatObservation[] {
    const rows = this.db.prepare(`
      SELECT * FROM heartbeat_observations
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(limit) as any[];

    return rows.map(row => ({
      id: row.id,
      timestamp: new Date(row.timestamp),
      attentionState: row.attention_state,
      urgentDrives: JSON.parse(row.urgent_drives_json),
      pendingTasks: row.pending_tasks,
      workingMemorySize: row.working_memory_size,
      decayResults: JSON.parse(row.decay_results_json),
      actionsProposed: JSON.parse(row.actions_proposed_json),
      actionsExecuted: JSON.parse(row.actions_executed_json),
      energyUsed: row.energy_used,
    }));
  }

  /**
   * Get heartbeat statistics
   */
  getStats(): {
    lastHeartbeat?: Date;
    totalHeartbeats: number;
    actionsExecutedTotal: number;
    averageEnergyUsed: number;
    isRunning: boolean;
    isEnabled: boolean;
  } {
    const stats = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(energy_used) as total_energy,
        AVG(energy_used) as avg_energy
      FROM heartbeat_observations
    `).get() as any;

    const actionsCount = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM heartbeat_events
      WHERE event_type = 'action_executed'
    `).get() as any;

    return {
      lastHeartbeat: this.lastHeartbeat,
      totalHeartbeats: stats?.total || 0,
      actionsExecutedTotal: actionsCount?.count || 0,
      averageEnergyUsed: stats?.avg_energy || 0,
      isRunning: !!this.timer,
      isEnabled: this.config.enabled,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<HeartbeatConfig>): void {
    const wasRunning = !!this.timer;

    if (wasRunning) {
      this.stop();
    }

    this.config = { ...this.config, ...config };

    if (wasRunning && this.config.enabled) {
      this.start();
    }
  }

  /**
   * Force a heartbeat immediately (bypasses quiet hours)
   */
  async forceHeartbeat(): Promise<HeartbeatObservation> {
    const wasEnabled = this.config.enabled;
    this.config.enabled = true;

    try {
      return await this.executeHeartbeat();
    } finally {
      this.config.enabled = wasEnabled;
    }
  }
}

// ============================================
// EXPORTS
// ============================================

export default {
  HeartbeatWorker,
  DEFAULT_CONFIG,
  ACTION_COSTS,
};
