/**
 * Attention State Inference for Ronald-GI
 *
 * Based on ADHD-Aware AI Framework (arxiv:2507.06864)
 *
 * Implements:
 * - Attention state classification (focused, scattered, crashed, transitioning)
 * - Tab/activity sensing for context detection
 * - ADHD-specific nudging strategies
 * - Cognitive load estimation
 * - DopBoost (gamification for dopamine regulation)
 *
 * Key insight from paper: ADHD users show characteristic patterns:
 * - High tab switching frequency = scattered
 * - Long dwell on single task = hyperfocus (can be good or bad)
 * - Rapid context switching + low completion = crashed
 */

import Database from 'better-sqlite3';

// ============================================
// TYPES
// ============================================

export type AttentionState =
  | 'focused'       // Deep work, low switching, high completion
  | 'scattered'     // High switching, partial engagement
  | 'hyperfocus'    // Very long single-task dwell (ADHD characteristic)
  | 'crashed'       // Low activity, high switching, no completion
  | 'transitioning' // Moving between states
  | 'unknown';

export type ActivityType =
  | 'coding'
  | 'research'
  | 'writing'
  | 'communication'
  | 'browsing'
  | 'meeting'
  | 'idle'
  | 'unknown';

export interface ActivityEvent {
  id: string;
  userId: string;
  timestamp: string;
  eventType: 'app_switch' | 'tab_switch' | 'url_visit' | 'idle' | 'active' | 'task_complete';
  appName?: string;
  url?: string;
  title?: string;
  durationMs?: number;
  metadata?: Record<string, any>;
}

export interface AttentionSnapshot {
  state: AttentionState;
  confidence: number;
  activityType: ActivityType;
  cognitiveLoad: 'low' | 'medium' | 'high' | 'overload';
  metrics: AttentionMetrics;
  timestamp: string;
  suggestedNudge?: Nudge;
}

export interface AttentionMetrics {
  switchFrequency: number;      // Switches per minute
  avgDwellTime: number;         // Average time on single context (ms)
  completionRate: number;       // Tasks completed / started
  tabCount: number;             // Current open tabs
  contextChanges: number;       // Distinct context changes in window
  focusScore: number;           // 0-1 composite focus metric
  hyperfocusRisk: number;       // 0-1 risk of hyperfocus trap
}

export interface Nudge {
  id: string;
  type: NudgeType;
  message: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  action?: NudgeAction;
  expiresAt?: string;
}

export type NudgeType =
  | 'gentle_reminder'   // Soft reminder of current task
  | 'break_suggestion'  // Time for a break
  | 'task_refocus'      // Return to main task
  | 'dopboost'          // Gamification element
  | 'body_double'       // Suggest accountability partner
  | 'cognitive_dump'    // Suggest brain dump
  | 'priority_check'    // Review priorities
  | 'celebration';      // Acknowledge completion

export interface NudgeAction {
  type: 'dismiss' | 'snooze' | 'accept' | 'defer';
  label: string;
  callback?: string;
}

// ============================================
// ATTENTION ANALYZER
// ============================================

export class AttentionAnalyzer {
  private readonly WINDOW_MINUTES = 15; // Analysis window
  private readonly SWITCH_THRESHOLD_SCATTERED = 8; // Switches/min for scattered
  private readonly SWITCH_THRESHOLD_CRASHED = 15;
  private readonly HYPERFOCUS_THRESHOLD_MS = 45 * 60 * 1000; // 45 min single task
  private readonly IDLE_THRESHOLD_MS = 5 * 60 * 1000; // 5 min no activity

  constructor(private db: Database.Database) {}

  /**
   * Get current attention state for a user
   */
  getAttentionState(userId: string): AttentionSnapshot {
    const events = this.getRecentEvents(userId, this.WINDOW_MINUTES);
    const metrics = this.calculateMetrics(events);
    const state = this.classifyState(metrics, events);
    const activityType = this.inferActivityType(events);
    const cognitiveLoad = this.estimateCognitiveLoad(metrics);
    const nudge = this.selectNudge(state, metrics, activityType);

    return {
      state,
      confidence: this.calculateConfidence(events.length, metrics),
      activityType,
      cognitiveLoad,
      metrics,
      timestamp: new Date().toISOString(),
      suggestedNudge: nudge,
    };
  }

  /**
   * Record an activity event
   */
  recordEvent(event: Omit<ActivityEvent, 'id'>): string {
    const id = this.generateId();

    this.db.prepare(`
      INSERT INTO attention_events
      (id, user_id, timestamp, event_type, app_name, url, title, duration_ms, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      event.userId,
      event.timestamp || new Date().toISOString(),
      event.eventType,
      event.appName || null,
      event.url || null,
      event.title || null,
      event.durationMs || null,
      JSON.stringify(event.metadata || {})
    );

    return id;
  }

  /**
   * Get attention history for a user
   */
  getAttentionHistory(userId: string, hours: number = 24): AttentionSnapshot[] {
    const snapshots = this.db.prepare(`
      SELECT * FROM attention_snapshots
      WHERE user_id = ?
        AND timestamp >= datetime('now', ?)
      ORDER BY timestamp DESC
    `).all(userId, `-${hours} hours`) as any[];

    return snapshots.map(this.mapSnapshot);
  }

  /**
   * Detect attention patterns over time
   */
  detectPatterns(userId: string, days: number = 7): AttentionPattern[] {
    const patterns: AttentionPattern[] = [];

    // Analyze hourly patterns
    const hourlyStats = this.db.prepare(`
      SELECT
        strftime('%H', timestamp) as hour,
        AVG(CASE WHEN state = 'focused' THEN 1 ELSE 0 END) as focus_rate,
        AVG(CASE WHEN state = 'scattered' THEN 1 ELSE 0 END) as scatter_rate,
        COUNT(*) as sample_count
      FROM attention_snapshots
      WHERE user_id = ?
        AND timestamp >= datetime('now', ?)
      GROUP BY hour
      ORDER BY hour
    `).all(userId, `-${days} days`) as any[];

    // Find peak focus hours
    const peakFocusHours = hourlyStats
      .filter(h => h.focus_rate > 0.6 && h.sample_count >= 3)
      .map(h => parseInt(h.hour));

    if (peakFocusHours.length > 0) {
      patterns.push({
        type: 'peak_focus_hours',
        description: `Peak focus typically between ${this.formatHours(peakFocusHours)}`,
        hours: peakFocusHours,
        confidence: 0.8,
      });
    }

    // Find scatter-prone hours
    const scatterHours = hourlyStats
      .filter(h => h.scatter_rate > 0.5 && h.sample_count >= 3)
      .map(h => parseInt(h.hour));

    if (scatterHours.length > 0) {
      patterns.push({
        type: 'scatter_prone_hours',
        description: `Higher scatter risk around ${this.formatHours(scatterHours)}`,
        hours: scatterHours,
        confidence: 0.7,
      });
    }

    return patterns;
  }

  /**
   * Save current attention snapshot
   */
  saveSnapshot(userId: string, snapshot: AttentionSnapshot): void {
    this.db.prepare(`
      INSERT INTO attention_snapshots
      (id, user_id, state, confidence, activity_type, cognitive_load, metrics_json, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      this.generateId(),
      userId,
      snapshot.state,
      snapshot.confidence,
      snapshot.activityType,
      snapshot.cognitiveLoad,
      JSON.stringify(snapshot.metrics),
      snapshot.timestamp
    );
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private getRecentEvents(userId: string, minutes: number): ActivityEvent[] {
    const rows = this.db.prepare(`
      SELECT * FROM attention_events
      WHERE user_id = ?
        AND timestamp >= datetime('now', ?)
      ORDER BY timestamp DESC
    `).all(userId, `-${minutes} minutes`) as any[];

    return rows.map(this.mapEvent);
  }

  private calculateMetrics(events: ActivityEvent[]): AttentionMetrics {
    if (events.length === 0) {
      return {
        switchFrequency: 0,
        avgDwellTime: 0,
        completionRate: 0,
        tabCount: 0,
        contextChanges: 0,
        focusScore: 0.5,
        hyperfocusRisk: 0,
      };
    }

    // Calculate switch frequency
    const switches = events.filter(e =>
      e.eventType === 'app_switch' || e.eventType === 'tab_switch'
    );
    const windowMinutes = this.WINDOW_MINUTES;
    const switchFrequency = switches.length / windowMinutes;

    // Calculate average dwell time
    const dwellTimes = events
      .filter(e => e.durationMs && e.durationMs > 0)
      .map(e => e.durationMs!);
    const avgDwellTime = dwellTimes.length > 0
      ? dwellTimes.reduce((a, b) => a + b, 0) / dwellTimes.length
      : 0;

    // Calculate completion rate
    const completions = events.filter(e => e.eventType === 'task_complete').length;
    const starts = events.filter(e =>
      e.eventType === 'app_switch' || e.eventType === 'tab_switch'
    ).length;
    const completionRate = starts > 0 ? completions / starts : 0;

    // Estimate tab count (from metadata)
    const tabEvents = events.filter(e => e.metadata?.tabCount);
    const tabCount = tabEvents.length > 0
      ? Math.max(...tabEvents.map(e => e.metadata?.tabCount || 0))
      : 0;

    // Count context changes
    const contexts = new Set(events.map(e =>
      e.appName || e.url?.split('/')[2] || 'unknown'
    ));
    const contextChanges = contexts.size;

    // Calculate focus score (0-1)
    const focusScore = this.calculateFocusScore(switchFrequency, avgDwellTime, completionRate);

    // Calculate hyperfocus risk
    const maxDwell = Math.max(...dwellTimes, 0);
    const hyperfocusRisk = Math.min(1, maxDwell / this.HYPERFOCUS_THRESHOLD_MS);

    return {
      switchFrequency,
      avgDwellTime,
      completionRate,
      tabCount,
      contextChanges,
      focusScore,
      hyperfocusRisk,
    };
  }

  private calculateFocusScore(
    switchFreq: number,
    avgDwell: number,
    completionRate: number
  ): number {
    // Lower switching = higher focus (max 0.4)
    const switchScore = Math.max(0, 0.4 * (1 - switchFreq / this.SWITCH_THRESHOLD_CRASHED));

    // Longer dwell = higher focus (max 0.3), but cap for hyperfocus
    const normalizedDwell = Math.min(avgDwell / (10 * 60 * 1000), 1); // Normalize to 10 min
    const dwellScore = 0.3 * normalizedDwell;

    // Higher completion = higher focus (max 0.3)
    const completionScore = 0.3 * completionRate;

    return Math.max(0, Math.min(1, switchScore + dwellScore + completionScore));
  }

  private classifyState(metrics: AttentionMetrics, events: ActivityEvent[]): AttentionState {
    // Check for idle
    if (events.length === 0) {
      return 'unknown';
    }

    const lastEvent = events[0];
    const msSinceLastEvent = Date.now() - new Date(lastEvent.timestamp).getTime();
    if (msSinceLastEvent > this.IDLE_THRESHOLD_MS) {
      return 'unknown';
    }

    // Check for hyperfocus (very long single-task engagement)
    if (metrics.hyperfocusRisk > 0.8 && metrics.contextChanges <= 2) {
      return 'hyperfocus';
    }

    // Check for crashed (high switching, no completion)
    if (
      metrics.switchFrequency > this.SWITCH_THRESHOLD_CRASHED &&
      metrics.completionRate < 0.1
    ) {
      return 'crashed';
    }

    // Check for scattered (moderate-high switching)
    if (metrics.switchFrequency > this.SWITCH_THRESHOLD_SCATTERED) {
      return 'scattered';
    }

    // Check for focused (low switching, reasonable completion)
    if (
      metrics.switchFrequency < this.SWITCH_THRESHOLD_SCATTERED / 2 &&
      metrics.focusScore > 0.6
    ) {
      return 'focused';
    }

    // Default to transitioning
    return 'transitioning';
  }

  private inferActivityType(events: ActivityEvent[]): ActivityType {
    if (events.length === 0) return 'unknown';

    // Count activity indicators
    const indicators: Record<ActivityType, number> = {
      coding: 0,
      research: 0,
      writing: 0,
      communication: 0,
      browsing: 0,
      meeting: 0,
      idle: 0,
      unknown: 0,
    };

    for (const event of events) {
      const app = (event.appName || '').toLowerCase();
      const url = (event.url || '').toLowerCase();
      const title = (event.title || '').toLowerCase();

      // Coding indicators
      if (app.includes('code') || app.includes('terminal') || app.includes('xcode') ||
          app.includes('intellij') || app.includes('pycharm') || app.includes('vim')) {
        indicators.coding += 2;
      }
      if (url.includes('github') || url.includes('stackoverflow') || url.includes('gitlab')) {
        indicators.coding += 1;
      }

      // Research indicators
      if (url.includes('arxiv') || url.includes('scholar') || url.includes('wikipedia') ||
          url.includes('docs.') || title.includes('documentation')) {
        indicators.research += 2;
      }

      // Communication indicators
      if (app.includes('slack') || app.includes('mail') || app.includes('teams') ||
          app.includes('discord') || app.includes('message')) {
        indicators.communication += 2;
      }

      // Meeting indicators
      if (app.includes('zoom') || app.includes('meet') || app.includes('teams')) {
        indicators.meeting += 2;
      }

      // Writing indicators
      if (app.includes('word') || app.includes('pages') || app.includes('notion') ||
          app.includes('docs')) {
        indicators.writing += 2;
      }

      // Browsing (default)
      if (app.includes('chrome') || app.includes('safari') || app.includes('firefox')) {
        indicators.browsing += 0.5;
      }

      // Idle
      if (event.eventType === 'idle') {
        indicators.idle += 2;
      }
    }

    // Return highest scoring activity
    const sorted = Object.entries(indicators)
      .sort((a, b) => b[1] - a[1]);

    return sorted[0][0] as ActivityType;
  }

  private estimateCognitiveLoad(metrics: AttentionMetrics): 'low' | 'medium' | 'high' | 'overload' {
    // Combine factors
    const tabPenalty = Math.min(1, metrics.tabCount / 20);
    const switchPenalty = Math.min(1, metrics.switchFrequency / this.SWITCH_THRESHOLD_CRASHED);
    const contextPenalty = Math.min(1, metrics.contextChanges / 10);

    const loadScore = (tabPenalty + switchPenalty + contextPenalty) / 3;

    if (loadScore < 0.25) return 'low';
    if (loadScore < 0.5) return 'medium';
    if (loadScore < 0.75) return 'high';
    return 'overload';
  }

  private selectNudge(
    state: AttentionState,
    metrics: AttentionMetrics,
    activityType: ActivityType
  ): Nudge | undefined {
    switch (state) {
      case 'scattered':
        return {
          id: this.generateId(),
          type: 'task_refocus',
          message: 'You seem to be switching a lot. What\'s the ONE thing you need to do right now?',
          priority: 'medium',
          action: { type: 'accept', label: 'Show my priorities' },
        };

      case 'crashed':
        return {
          id: this.generateId(),
          type: 'break_suggestion',
          message: 'High switching detected. Time for a 5-minute break to reset?',
          priority: 'high',
          action: { type: 'accept', label: 'Start break timer' },
        };

      case 'hyperfocus':
        return {
          id: this.generateId(),
          type: 'gentle_reminder',
          message: `You've been deeply focused for a while. Remember to stretch and hydrate.`,
          priority: 'low',
          action: { type: 'dismiss', label: 'I\'m good' },
        };

      case 'focused':
        // Only nudge occasionally during focus
        if (Math.random() < 0.1) { // 10% chance
          return {
            id: this.generateId(),
            type: 'dopboost',
            message: 'Great focus streak! You\'re in the zone.',
            priority: 'low',
          };
        }
        return undefined;

      default:
        return undefined;
    }
  }

  private calculateConfidence(eventCount: number, metrics: AttentionMetrics): number {
    // More events = higher confidence
    const eventConfidence = Math.min(1, eventCount / 20);

    // Clear patterns = higher confidence
    const patternClarity = metrics.focusScore > 0.7 || metrics.focusScore < 0.3
      ? 0.8
      : 0.5;

    return (eventConfidence + patternClarity) / 2;
  }

  private formatHours(hours: number[]): string {
    if (hours.length === 0) return '';
    if (hours.length === 1) return `${hours[0]}:00`;

    const sorted = hours.sort((a, b) => a - b);
    return `${sorted[0]}:00-${sorted[sorted.length - 1]}:00`;
  }

  private mapEvent(row: any): ActivityEvent {
    return {
      id: row.id,
      userId: row.user_id,
      timestamp: row.timestamp,
      eventType: row.event_type,
      appName: row.app_name,
      url: row.url,
      title: row.title,
      durationMs: row.duration_ms,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : {},
    };
  }

  private mapSnapshot(row: any): AttentionSnapshot {
    return {
      state: row.state,
      confidence: row.confidence,
      activityType: row.activity_type,
      cognitiveLoad: row.cognitive_load,
      metrics: row.metrics_json ? JSON.parse(row.metrics_json) : {},
      timestamp: row.timestamp,
    };
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 15) +
           Math.random().toString(36).substring(2, 15);
  }
}

// ============================================
// NUDGE MANAGER
// ============================================

export class NudgeManager {
  private readonly COOLDOWN_MINUTES = 10; // Min time between nudges

  constructor(private db: Database.Database) {}

  /**
   * Check if a nudge should be shown (respecting cooldowns)
   */
  shouldShowNudge(userId: string, nudgeType: NudgeType): boolean {
    const lastNudge = this.db.prepare(`
      SELECT timestamp FROM nudge_history
      WHERE user_id = ? AND nudge_type = ?
      ORDER BY timestamp DESC
      LIMIT 1
    `).get(userId, nudgeType) as { timestamp: string } | undefined;

    if (!lastNudge) return true;

    const msSinceLastNudge = Date.now() - new Date(lastNudge.timestamp).getTime();
    return msSinceLastNudge > this.COOLDOWN_MINUTES * 60 * 1000;
  }

  /**
   * Record that a nudge was shown
   */
  recordNudge(userId: string, nudge: Nudge): void {
    this.db.prepare(`
      INSERT INTO nudge_history (id, user_id, nudge_type, message, priority, timestamp)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(nudge.id, userId, nudge.type, nudge.message, nudge.priority);
  }

  /**
   * Record user response to a nudge
   */
  recordResponse(nudgeId: string, response: 'accepted' | 'dismissed' | 'snoozed'): void {
    this.db.prepare(`
      UPDATE nudge_history SET response = ?, responded_at = datetime('now')
      WHERE id = ?
    `).run(response, nudgeId);
  }

  /**
   * Get nudge effectiveness stats
   */
  getNudgeStats(userId: string): NudgeStats {
    const stats = this.db.prepare(`
      SELECT
        nudge_type,
        COUNT(*) as shown,
        SUM(CASE WHEN response = 'accepted' THEN 1 ELSE 0 END) as accepted,
        SUM(CASE WHEN response = 'dismissed' THEN 1 ELSE 0 END) as dismissed
      FROM nudge_history
      WHERE user_id = ?
      GROUP BY nudge_type
    `).all(userId) as any[];

    return {
      byType: Object.fromEntries(
        stats.map(s => [s.nudge_type, {
          shown: s.shown,
          accepted: s.accepted,
          dismissed: s.dismissed,
          acceptRate: s.shown > 0 ? s.accepted / s.shown : 0,
        }])
      ),
    };
  }
}

// ============================================
// DOPBOOST SYSTEM
// ============================================

export class DopBoostSystem {
  constructor(private db: Database.Database) {}

  /**
   * Award points for focus achievements
   */
  awardPoints(userId: string, reason: string, points: number): void {
    this.db.prepare(`
      INSERT INTO dopboost_points (id, user_id, reason, points, timestamp)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(this.generateId(), userId, reason, points);
  }

  /**
   * Get current streak info
   */
  getStreak(userId: string): StreakInfo {
    const today = new Date().toISOString().split('T')[0];

    // Count consecutive days with focus sessions
    const days = this.db.prepare(`
      SELECT DISTINCT date(timestamp) as day
      FROM attention_snapshots
      WHERE user_id = ? AND state = 'focused'
      ORDER BY day DESC
    `).all(userId) as { day: string }[];

    let currentStreak = 0;
    let checkDate = new Date(today);

    for (const { day } of days) {
      const dayDate = new Date(day);
      const diffDays = Math.floor((checkDate.getTime() - dayDate.getTime()) / (1000 * 60 * 60 * 24));

      if (diffDays <= 1) {
        currentStreak++;
        checkDate = dayDate;
      } else {
        break;
      }
    }

    // Get total points
    const pointsResult = this.db.prepare(`
      SELECT SUM(points) as total FROM dopboost_points WHERE user_id = ?
    `).get(userId) as { total: number | null };

    return {
      currentStreak,
      longestStreak: currentStreak, // TODO: Track separately
      totalPoints: pointsResult?.total || 0,
      lastFocusSession: days[0]?.day,
    };
  }

  /**
   * Get achievements
   */
  getAchievements(userId: string): Achievement[] {
    const streak = this.getStreak(userId);
    const achievements: Achievement[] = [];

    if (streak.currentStreak >= 3) {
      achievements.push({
        id: 'streak_3',
        name: '3-Day Focus Streak',
        description: 'Maintained focus for 3 consecutive days',
        earned: true,
        earnedAt: new Date().toISOString(),
      });
    }

    if (streak.currentStreak >= 7) {
      achievements.push({
        id: 'streak_7',
        name: 'Week Warrior',
        description: 'Full week of consistent focus',
        earned: true,
        earnedAt: new Date().toISOString(),
      });
    }

    if (streak.totalPoints >= 100) {
      achievements.push({
        id: 'points_100',
        name: 'Century Club',
        description: 'Earned 100 focus points',
        earned: true,
        earnedAt: new Date().toISOString(),
      });
    }

    return achievements;
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 15);
  }
}

// ============================================
// TYPES
// ============================================

export interface AttentionPattern {
  type: string;
  description: string;
  hours?: number[];
  confidence: number;
}

export interface NudgeStats {
  byType: Record<string, {
    shown: number;
    accepted: number;
    dismissed: number;
    acceptRate: number;
  }>;
}

export interface StreakInfo {
  currentStreak: number;
  longestStreak: number;
  totalPoints: number;
  lastFocusSession?: string;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  earned: boolean;
  earnedAt?: string;
}

// ============================================
// FACTORY
// ============================================

export function createAttentionSystem(db: Database.Database): {
  analyzer: AttentionAnalyzer;
  nudges: NudgeManager;
  dopboost: DopBoostSystem;
} {
  return {
    analyzer: new AttentionAnalyzer(db),
    nudges: new NudgeManager(db),
    dopboost: new DopBoostSystem(db),
  };
}
