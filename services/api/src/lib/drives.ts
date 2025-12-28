/**
 * Drives System for Ronald-GI
 *
 * Inspired by QuixiAI's AGI Memory intrinsic drives system.
 *
 * Drives are internal motivations that accumulate over time and
 * demand satisfaction. For ADHD users, drives model the unique
 * motivational patterns:
 *
 * - Focus Drive: Builds during scattered states, satisfied by deep work
 * - Completion Drive: Builds with unfinished tasks, satisfied by finishing
 * - Novelty Drive: Builds during routine, satisfied by new stimulation
 * - Rest Drive: Builds during hyperfocus, satisfied by breaks
 * - Curiosity Drive: Builds with unanswered questions
 *
 * Unlike desires (which are explicit wants), drives are implicit
 * motivational forces that influence behavior.
 */

import type { Database } from 'better-sqlite3';
import type { AttentionState } from './attention_inference';

// ============================================
// TYPES
// ============================================

export type DriveType =
  | 'focus'       // Need for sustained concentration
  | 'completion'  // Need to finish things
  | 'novelty'     // Need for new stimulation (ADHD-specific)
  | 'rest'        // Need for recovery
  | 'curiosity'   // Need to learn/explore
  | 'connection'  // Need for social interaction
  | 'mastery';    // Need to improve skills

export interface Drive {
  type: DriveType;
  level: number;              // 0-100 (current drive level)
  baselineLevel: number;      // Normal resting level (personalized)
  accumulationRate: number;   // Points per hour when active
  decayRate: number;          // Points per hour toward baseline
  satisfactionThreshold: number; // Level at which drive demands action
  lastUpdated: Date;
  lastSatisfied?: Date;
}

export interface DriveEvent {
  driveType: DriveType;
  eventType: 'accumulate' | 'satisfy' | 'decay';
  amount: number;
  levelBefore: number;
  levelAfter: number;
  trigger: string;
  timestamp: Date;
}

export interface DriveSatisfier {
  driveType: DriveType;
  action: string;
  effectiveness: number;  // 0-1, how well this satisfies the drive
}

// ============================================
// DEFAULT CONFIGURATIONS
// ============================================

const DEFAULT_DRIVES: Record<DriveType, Omit<Drive, 'lastUpdated' | 'lastSatisfied'>> = {
  focus: {
    type: 'focus',
    level: 30,
    baselineLevel: 30,
    accumulationRate: 5,      // +5/hour when scattered
    decayRate: 2,             // -2/hour toward baseline
    satisfactionThreshold: 70,
  },
  completion: {
    type: 'completion',
    level: 20,
    baselineLevel: 20,
    accumulationRate: 3,      // +3/hour with pending tasks
    decayRate: 1,
    satisfactionThreshold: 60,
  },
  novelty: {
    type: 'novelty',
    level: 40,
    baselineLevel: 40,
    accumulationRate: 8,      // ADHD: high novelty need
    decayRate: 3,
    satisfactionThreshold: 75,
  },
  rest: {
    type: 'rest',
    level: 10,
    baselineLevel: 10,
    accumulationRate: 4,      // +4/hour during hyperfocus
    decayRate: 5,             // Decays quickly after rest
    satisfactionThreshold: 60,
  },
  curiosity: {
    type: 'curiosity',
    level: 50,
    baselineLevel: 50,
    accumulationRate: 4,
    decayRate: 2,
    satisfactionThreshold: 80,
  },
  connection: {
    type: 'connection',
    level: 30,
    baselineLevel: 30,
    accumulationRate: 2,
    decayRate: 1,
    satisfactionThreshold: 65,
  },
  mastery: {
    type: 'mastery',
    level: 40,
    baselineLevel: 40,
    accumulationRate: 3,
    decayRate: 1,
    satisfactionThreshold: 70,
  },
};

// ============================================
// DRIVE SATISFIERS
// ============================================

const DEFAULT_SATISFIERS: DriveSatisfier[] = [
  // Focus drive
  { driveType: 'focus', action: 'complete_deep_work_session', effectiveness: 0.8 },
  { driveType: 'focus', action: 'finish_complex_task', effectiveness: 0.6 },
  { driveType: 'focus', action: 'enter_flow_state', effectiveness: 1.0 },

  // Completion drive
  { driveType: 'completion', action: 'finish_task', effectiveness: 0.7 },
  { driveType: 'completion', action: 'clear_inbox', effectiveness: 0.5 },
  { driveType: 'completion', action: 'complete_project', effectiveness: 1.0 },

  // Novelty drive
  { driveType: 'novelty', action: 'learn_new_topic', effectiveness: 0.8 },
  { driveType: 'novelty', action: 'start_new_project', effectiveness: 0.7 },
  { driveType: 'novelty', action: 'explore_new_tool', effectiveness: 0.6 },
  { driveType: 'novelty', action: 'read_interesting_article', effectiveness: 0.4 },

  // Rest drive
  { driveType: 'rest', action: 'take_break', effectiveness: 0.6 },
  { driveType: 'rest', action: 'go_for_walk', effectiveness: 0.8 },
  { driveType: 'rest', action: 'meditate', effectiveness: 0.7 },
  { driveType: 'rest', action: 'sleep', effectiveness: 1.0 },

  // Curiosity drive
  { driveType: 'curiosity', action: 'research_question', effectiveness: 0.7 },
  { driveType: 'curiosity', action: 'read_paper', effectiveness: 0.6 },
  { driveType: 'curiosity', action: 'experiment', effectiveness: 0.8 },

  // Connection drive
  { driveType: 'connection', action: 'have_conversation', effectiveness: 0.7 },
  { driveType: 'connection', action: 'collaborate', effectiveness: 0.8 },
  { driveType: 'connection', action: 'help_someone', effectiveness: 0.6 },

  // Mastery drive
  { driveType: 'mastery', action: 'practice_skill', effectiveness: 0.6 },
  { driveType: 'mastery', action: 'complete_challenge', effectiveness: 0.8 },
  { driveType: 'mastery', action: 'learn_advanced_technique', effectiveness: 0.7 },
];

// ============================================
// DRIVES MANAGER
// ============================================

export class DrivesManager {
  private drives: Map<DriveType, Drive> = new Map();
  private satisfiers: DriveSatisfier[] = DEFAULT_SATISFIERS;

  constructor(private db: Database) {
    this.loadDrives();
  }

  /**
   * Load drives from database or initialize defaults
   */
  private loadDrives(): void {
    const rows = this.db.prepare(`SELECT * FROM user_drives`).all() as any[];

    if (rows.length === 0) {
      // Initialize with defaults
      for (const [type, config] of Object.entries(DEFAULT_DRIVES)) {
        const drive: Drive = {
          ...config,
          lastUpdated: new Date(),
        };
        this.drives.set(type as DriveType, drive);
        this.saveDrive(drive);
      }
    } else {
      for (const row of rows) {
        this.drives.set(row.type as DriveType, {
          type: row.type,
          level: row.level,
          baselineLevel: row.baseline_level,
          accumulationRate: row.accumulation_rate,
          decayRate: row.decay_rate,
          satisfactionThreshold: row.satisfaction_threshold,
          lastUpdated: new Date(row.last_updated),
          lastSatisfied: row.last_satisfied ? new Date(row.last_satisfied) : undefined,
        });
      }
    }
  }

  /**
   * Save a drive to database
   */
  private saveDrive(drive: Drive): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO user_drives (
        type, level, baseline_level, accumulation_rate, decay_rate,
        satisfaction_threshold, last_updated, last_satisfied
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      drive.type,
      drive.level,
      drive.baselineLevel,
      drive.accumulationRate,
      drive.decayRate,
      drive.satisfactionThreshold,
      drive.lastUpdated.toISOString(),
      drive.lastSatisfied?.toISOString() || null
    );
  }

  /**
   * Record a drive event
   */
  private recordEvent(event: DriveEvent): void {
    this.db.prepare(`
      INSERT INTO drive_events (
        id, drive_type, event_type, amount, level_before, level_after, trigger, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `de_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      event.driveType,
      event.eventType,
      event.amount,
      event.levelBefore,
      event.levelAfter,
      event.trigger,
      event.timestamp.toISOString()
    );
  }

  /**
   * Get a specific drive
   */
  getDrive(type: DriveType): Drive | undefined {
    return this.drives.get(type);
  }

  /**
   * Get all drives
   */
  getAllDrives(): Drive[] {
    return [...this.drives.values()];
  }

  /**
   * Get drives that have exceeded their satisfaction threshold
   */
  getUrgentDrives(): Drive[] {
    return this.getAllDrives()
      .filter(d => d.level >= d.satisfactionThreshold)
      .sort((a, b) => (b.level - b.satisfactionThreshold) - (a.level - a.satisfactionThreshold));
  }

  /**
   * Accumulate drive based on a trigger
   */
  accumulate(type: DriveType, amount: number, trigger: string): void {
    const drive = this.drives.get(type);
    if (!drive) return;

    const levelBefore = drive.level;
    drive.level = Math.min(100, drive.level + amount);
    drive.lastUpdated = new Date();

    this.saveDrive(drive);
    this.recordEvent({
      driveType: type,
      eventType: 'accumulate',
      amount,
      levelBefore,
      levelAfter: drive.level,
      trigger,
      timestamp: new Date(),
    });
  }

  /**
   * Satisfy a drive
   */
  satisfy(type: DriveType, action: string): number {
    const drive = this.drives.get(type);
    if (!drive) return 0;

    // Find the satisfier for this action
    const satisfier = this.satisfiers.find(
      s => s.driveType === type && s.action === action
    );
    const effectiveness = satisfier?.effectiveness ?? 0.5;

    const levelBefore = drive.level;
    const reduction = Math.floor((drive.level - drive.baselineLevel) * effectiveness);
    drive.level = Math.max(drive.baselineLevel, drive.level - reduction);
    drive.lastSatisfied = new Date();
    drive.lastUpdated = new Date();

    this.saveDrive(drive);
    this.recordEvent({
      driveType: type,
      eventType: 'satisfy',
      amount: reduction,
      levelBefore,
      levelAfter: drive.level,
      trigger: action,
      timestamp: new Date(),
    });

    return reduction;
  }

  /**
   * Apply decay toward baseline (call periodically)
   */
  applyDecay(): void {
    const now = new Date();

    for (const drive of this.drives.values()) {
      const hoursSinceUpdate = (now.getTime() - drive.lastUpdated.getTime()) / (1000 * 60 * 60);
      if (hoursSinceUpdate < 0.1) continue; // Skip if updated very recently

      const levelBefore = drive.level;

      // Decay toward baseline
      if (drive.level > drive.baselineLevel) {
        const decay = drive.decayRate * hoursSinceUpdate;
        drive.level = Math.max(drive.baselineLevel, drive.level - decay);
      } else if (drive.level < drive.baselineLevel) {
        const recovery = drive.decayRate * hoursSinceUpdate;
        drive.level = Math.min(drive.baselineLevel, drive.level + recovery);
      }

      if (drive.level !== levelBefore) {
        drive.lastUpdated = now;
        this.saveDrive(drive);
        this.recordEvent({
          driveType: drive.type,
          eventType: 'decay',
          amount: Math.abs(drive.level - levelBefore),
          levelBefore,
          levelAfter: drive.level,
          trigger: 'time_decay',
          timestamp: now,
        });
      }
    }
  }

  /**
   * Update drives based on attention state (ADHD-specific)
   */
  updateFromAttentionState(state: AttentionState): void {
    switch (state) {
      case 'scattered':
        this.accumulate('focus', 3, 'scattered_attention');
        this.accumulate('novelty', 1, 'seeking_stimulation');
        break;

      case 'crashed':
        this.accumulate('focus', 5, 'crashed_state');
        this.accumulate('rest', 4, 'exhaustion');
        break;

      case 'hyperfocus':
        this.accumulate('rest', 2, 'hyperfocus_strain');
        // Novelty drive decreases during hyperfocus
        const novelty = this.drives.get('novelty');
        if (novelty && novelty.level > novelty.baselineLevel) {
          novelty.level = Math.max(novelty.baselineLevel, novelty.level - 2);
          this.saveDrive(novelty);
        }
        break;

      case 'focused':
        // Healthy state - moderate drive changes
        this.accumulate('mastery', 1, 'productive_work');
        break;
    }
  }

  /**
   * Update drives based on task completion
   */
  updateFromTaskCompletion(taskComplexity: 'simple' | 'medium' | 'complex'): void {
    const points = taskComplexity === 'complex' ? 20 :
                   taskComplexity === 'medium' ? 12 : 5;

    this.satisfy('completion', 'finish_task');
    this.satisfy('mastery', 'complete_challenge');

    // Also reduce focus drive if it was a focused task
    if (taskComplexity !== 'simple') {
      this.satisfy('focus', 'finish_complex_task');
    }
  }

  /**
   * Get suggestions for satisfying urgent drives
   */
  getSuggestions(): Array<{
    drive: Drive;
    suggestions: string[];
    urgency: number;
  }> {
    const urgent = this.getUrgentDrives();

    return urgent.map(drive => {
      const relevantSatisfiers = this.satisfiers.filter(s => s.driveType === drive.type);
      const suggestions = relevantSatisfiers
        .sort((a, b) => b.effectiveness - a.effectiveness)
        .slice(0, 3)
        .map(s => s.action);

      return {
        drive,
        suggestions,
        urgency: (drive.level - drive.satisfactionThreshold) / (100 - drive.satisfactionThreshold),
      };
    });
  }

  /**
   * Get drive statistics
   */
  getStats(): {
    averageLevel: number;
    urgentCount: number;
    mostUrgent?: DriveType;
    recentlySatisfied: DriveType[];
  } {
    const drives = this.getAllDrives();
    const urgent = this.getUrgentDrives();
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;

    const recentlySatisfied = drives
      .filter(d => d.lastSatisfied && d.lastSatisfied.getTime() > oneHourAgo)
      .map(d => d.type);

    return {
      averageLevel: drives.reduce((sum, d) => sum + d.level, 0) / drives.length,
      urgentCount: urgent.length,
      mostUrgent: urgent[0]?.type,
      recentlySatisfied,
    };
  }
}

// ============================================
// EXPORTS
// ============================================

export default {
  DrivesManager,
  DEFAULT_DRIVES,
  DEFAULT_SATISFIERS,
};
