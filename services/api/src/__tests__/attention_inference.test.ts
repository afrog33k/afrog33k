/**
 * Attention State Inference Tests for Ronald-GI
 *
 * Based on ADHD-Aware AI Framework (arxiv:2507.06864)
 *
 * Tests verify:
 * 1. Accurate attention state classification (focused, scattered, crashed, hyperfocus)
 * 2. Activity type inference from app/URL patterns
 * 3. Cognitive load estimation
 * 4. Appropriate nudge selection based on state
 * 5. DopBoost gamification system
 * 6. Pattern detection over time
 *
 * ADHD-specific behaviors tested:
 * - High tab switching as scatter signal
 * - Hyperfocus detection and gentle interruption
 * - Crash detection and break suggestions
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  getTestDb,
  resetTestDb,
  closeTestDb,
  createTestUserProfile,
  createTestActivityEvent,
  simulateFocusedActivity,
  simulateScatteredActivity,
  simulateCrashedActivity,
  simulateHyperfocus,
} from './setup';
import {
  AttentionAnalyzer,
  NudgeManager,
  DopBoostSystem,
  createAttentionSystem,
  type AttentionState,
  type ActivityType,
} from '../lib/attention_inference';

describe('Attention Inference: State Classification', () => {
  let db: ReturnType<typeof getTestDb>;
  let analyzer: AttentionAnalyzer;

  beforeEach(() => {
    resetTestDb();
    db = getTestDb();
    analyzer = new AttentionAnalyzer(db);
    createTestUserProfile(db, { id: 'test_user', name: 'Test User' });
  });

  afterAll(() => {
    closeTestDb();
  });

  describe('Focused State Detection', () => {
    it('should detect focused state with low switching and completions', () => {
      simulateFocusedActivity(db, 'test_user');

      const snapshot = analyzer.getAttentionState('test_user');

      expect(snapshot.state).toBe('focused');
      expect(snapshot.metrics.switchFrequency).toBeLessThan(8);
      expect(snapshot.metrics.completionRate).toBeGreaterThan(0);
    });

    it('should report high focus score for focused state', () => {
      simulateFocusedActivity(db, 'test_user');

      const snapshot = analyzer.getAttentionState('test_user');

      expect(snapshot.metrics.focusScore).toBeGreaterThan(0.5);
    });
  });

  describe('Scattered State Detection', () => {
    it('should detect scattered state with high switching', () => {
      simulateScatteredActivity(db, 'test_user');

      const snapshot = analyzer.getAttentionState('test_user');

      expect(snapshot.state).toBe('scattered');
      expect(snapshot.metrics.switchFrequency).toBeGreaterThan(8);
    });

    it('should track high tab count as scatter signal', () => {
      simulateScatteredActivity(db, 'test_user');

      const snapshot = analyzer.getAttentionState('test_user');

      expect(snapshot.metrics.tabCount).toBeGreaterThan(10);
    });
  });

  describe('Crashed State Detection', () => {
    it('should detect crashed state with very high switching and no completion', () => {
      simulateCrashedActivity(db, 'test_user');

      const snapshot = analyzer.getAttentionState('test_user');

      expect(snapshot.state).toBe('crashed');
      expect(snapshot.metrics.switchFrequency).toBeGreaterThan(15);
      expect(snapshot.metrics.completionRate).toBe(0);
    });

    it('should suggest break for crashed state', () => {
      simulateCrashedActivity(db, 'test_user');

      const snapshot = analyzer.getAttentionState('test_user');

      expect(snapshot.suggestedNudge).toBeDefined();
      expect(snapshot.suggestedNudge?.type).toBe('break_suggestion');
      expect(snapshot.suggestedNudge?.priority).toBe('high');
    });
  });

  describe('Hyperfocus Detection', () => {
    it('should detect hyperfocus with long single-context engagement', () => {
      simulateHyperfocus(db, 'test_user');

      const snapshot = analyzer.getAttentionState('test_user');

      expect(snapshot.state).toBe('hyperfocus');
      expect(snapshot.metrics.hyperfocusRisk).toBeGreaterThan(0.8);
    });

    it('should provide gentle reminder for hyperfocus', () => {
      simulateHyperfocus(db, 'test_user');

      const snapshot = analyzer.getAttentionState('test_user');

      expect(snapshot.suggestedNudge).toBeDefined();
      expect(snapshot.suggestedNudge?.type).toBe('gentle_reminder');
      expect(snapshot.suggestedNudge?.priority).toBe('low');
    });
  });

  describe('Unknown State', () => {
    it('should return unknown state with no events', () => {
      const snapshot = analyzer.getAttentionState('test_user');

      expect(snapshot.state).toBe('unknown');
      expect(snapshot.confidence).toBeLessThan(0.5);
    });

    it('should return unknown for stale events', () => {
      // Create old event (more than 5 min ago)
      createTestActivityEvent(db, {
        userId: 'test_user',
        timestamp: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        eventType: 'app_switch',
        appName: 'VS Code',
      });

      const snapshot = analyzer.getAttentionState('test_user');

      expect(snapshot.state).toBe('unknown');
    });
  });
});

describe('Attention Inference: Activity Type Classification', () => {
  let db: ReturnType<typeof getTestDb>;
  let analyzer: AttentionAnalyzer;

  beforeEach(() => {
    resetTestDb();
    db = getTestDb();
    analyzer = new AttentionAnalyzer(db);
    createTestUserProfile(db, { id: 'test_user', name: 'Test User' });
  });

  afterAll(() => {
    closeTestDb();
  });

  it('should detect coding activity', () => {
    const now = new Date();
    for (let i = 0; i < 5; i++) {
      createTestActivityEvent(db, {
        userId: 'test_user',
        timestamp: new Date(now.getTime() - i * 2 * 60 * 1000).toISOString(),
        eventType: 'app_switch',
        appName: 'VS Code',
        url: 'https://github.com/user/repo',
      });
    }

    const snapshot = analyzer.getAttentionState('test_user');
    expect(snapshot.activityType).toBe('coding');
  });

  it('should detect research activity', () => {
    const now = new Date();
    for (let i = 0; i < 5; i++) {
      createTestActivityEvent(db, {
        userId: 'test_user',
        timestamp: new Date(now.getTime() - i * 2 * 60 * 1000).toISOString(),
        eventType: 'tab_switch',
        appName: 'Chrome',
        url: 'https://arxiv.org/abs/2507.06864',
        title: 'ADHD-Aware AI Framework documentation',
      });
    }

    const snapshot = analyzer.getAttentionState('test_user');
    expect(snapshot.activityType).toBe('research');
  });

  it('should detect communication activity', () => {
    const now = new Date();
    for (let i = 0; i < 5; i++) {
      createTestActivityEvent(db, {
        userId: 'test_user',
        timestamp: new Date(now.getTime() - i * 2 * 60 * 1000).toISOString(),
        eventType: 'app_switch',
        appName: 'Slack',
      });
    }

    const snapshot = analyzer.getAttentionState('test_user');
    expect(snapshot.activityType).toBe('communication');
  });

  it('should detect meeting activity', () => {
    const now = new Date();
    createTestActivityEvent(db, {
      userId: 'test_user',
      timestamp: new Date(now.getTime() - 5 * 60 * 1000).toISOString(),
      eventType: 'app_switch',
      appName: 'Zoom',
      durationMs: 30 * 60 * 1000,
    });

    const snapshot = analyzer.getAttentionState('test_user');
    expect(snapshot.activityType).toBe('meeting');
  });
});

describe('Attention Inference: Cognitive Load Estimation', () => {
  let db: ReturnType<typeof getTestDb>;
  let analyzer: AttentionAnalyzer;

  beforeEach(() => {
    resetTestDb();
    db = getTestDb();
    analyzer = new AttentionAnalyzer(db);
    createTestUserProfile(db, { id: 'test_user', name: 'Test User' });
  });

  afterAll(() => {
    closeTestDb();
  });

  it('should detect low cognitive load with few tabs and switches', () => {
    simulateFocusedActivity(db, 'test_user');

    const snapshot = analyzer.getAttentionState('test_user');
    expect(snapshot.cognitiveLoad).toBe('low');
  });

  it('should detect high cognitive load with many tabs and switches', () => {
    simulateScatteredActivity(db, 'test_user');

    const snapshot = analyzer.getAttentionState('test_user');
    expect(['high', 'overload']).toContain(snapshot.cognitiveLoad);
  });

  it('should detect overload with crashed state metrics', () => {
    simulateCrashedActivity(db, 'test_user');

    const snapshot = analyzer.getAttentionState('test_user');
    expect(snapshot.cognitiveLoad).toBe('overload');
  });
});

describe('Attention Inference: Nudge System', () => {
  let db: ReturnType<typeof getTestDb>;
  let analyzer: AttentionAnalyzer;
  let nudges: NudgeManager;

  beforeEach(() => {
    resetTestDb();
    db = getTestDb();
    const system = createAttentionSystem(db);
    analyzer = system.analyzer;
    nudges = system.nudges;
    createTestUserProfile(db, { id: 'test_user', name: 'Test User' });
  });

  afterAll(() => {
    closeTestDb();
  });

  describe('Nudge Selection', () => {
    it('should suggest task_refocus for scattered state', () => {
      simulateScatteredActivity(db, 'test_user');

      const snapshot = analyzer.getAttentionState('test_user');

      expect(snapshot.suggestedNudge?.type).toBe('task_refocus');
      expect(snapshot.suggestedNudge?.message).toContain('ONE thing');
    });

    it('should suggest break for crashed state', () => {
      simulateCrashedActivity(db, 'test_user');

      const snapshot = analyzer.getAttentionState('test_user');

      expect(snapshot.suggestedNudge?.type).toBe('break_suggestion');
      expect(snapshot.suggestedNudge?.message).toContain('break');
    });

    it('should suggest gentle_reminder for hyperfocus', () => {
      simulateHyperfocus(db, 'test_user');

      const snapshot = analyzer.getAttentionState('test_user');

      expect(snapshot.suggestedNudge?.type).toBe('gentle_reminder');
      expect(snapshot.suggestedNudge?.message).toContain('stretch');
    });
  });

  describe('Nudge Cooldowns', () => {
    it('should respect cooldown period between nudges', () => {
      // Record a recent nudge
      nudges.recordNudge('test_user', {
        id: 'nudge1',
        type: 'task_refocus',
        message: 'Test nudge',
        priority: 'medium',
      });

      // Should not show same type immediately
      const shouldShow = nudges.shouldShowNudge('test_user', 'task_refocus');
      expect(shouldShow).toBe(false);
    });

    it('should allow different nudge types', () => {
      nudges.recordNudge('test_user', {
        id: 'nudge1',
        type: 'task_refocus',
        message: 'Test nudge',
        priority: 'medium',
      });

      const shouldShow = nudges.shouldShowNudge('test_user', 'break_suggestion');
      expect(shouldShow).toBe(true);
    });
  });

  describe('Nudge Response Tracking', () => {
    it('should track nudge responses', () => {
      nudges.recordNudge('test_user', {
        id: 'nudge1',
        type: 'task_refocus',
        message: 'Test nudge',
        priority: 'medium',
      });

      nudges.recordResponse('nudge1', 'accepted');

      const stats = nudges.getNudgeStats('test_user');
      expect(stats.byType['task_refocus'].accepted).toBe(1);
    });

    it('should calculate acceptance rate', () => {
      // Record multiple nudges with responses
      for (let i = 0; i < 3; i++) {
        nudges.recordNudge('test_user', {
          id: `nudge${i}`,
          type: 'break_suggestion',
          message: 'Take a break',
          priority: 'medium',
        });
        nudges.recordResponse(`nudge${i}`, i < 2 ? 'accepted' : 'dismissed');
      }

      const stats = nudges.getNudgeStats('test_user');
      expect(stats.byType['break_suggestion'].acceptRate).toBeCloseTo(2 / 3, 1);
    });
  });
});

describe('Attention Inference: DopBoost System', () => {
  let db: ReturnType<typeof getTestDb>;
  let dopboost: DopBoostSystem;

  beforeEach(() => {
    resetTestDb();
    db = getTestDb();
    dopboost = new DopBoostSystem(db);
    createTestUserProfile(db, { id: 'test_user', name: 'Test User' });
  });

  afterAll(() => {
    closeTestDb();
  });

  describe('Points System', () => {
    it('should award points for achievements', () => {
      dopboost.awardPoints('test_user', 'Focus session completed', 10);
      dopboost.awardPoints('test_user', 'Task completed', 5);

      const streak = dopboost.getStreak('test_user');
      expect(streak.totalPoints).toBe(15);
    });
  });

  describe('Streak Tracking', () => {
    it('should track focus streaks', () => {
      // Create focus snapshots for consecutive days
      const today = new Date();
      for (let i = 0; i < 3; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);

        db.prepare(`
          INSERT INTO attention_snapshots (id, user_id, state, confidence, activity_type, cognitive_load, metrics_json, timestamp)
          VALUES (?, 'test_user', 'focused', 0.8, 'coding', 'low', '{}', ?)
        `).run(`snap${i}`, date.toISOString());
      }

      const streak = dopboost.getStreak('test_user');
      expect(streak.currentStreak).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Achievements', () => {
    it('should unlock 3-day streak achievement', () => {
      // Create 3-day streak
      const today = new Date();
      for (let i = 0; i < 3; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);

        db.prepare(`
          INSERT INTO attention_snapshots (id, user_id, state, confidence, activity_type, cognitive_load, metrics_json, timestamp)
          VALUES (?, 'test_user', 'focused', 0.8, 'coding', 'low', '{}', ?)
        `).run(`snap${i}`, date.toISOString());
      }

      const achievements = dopboost.getAchievements('test_user');
      expect(achievements.some(a => a.id === 'streak_3')).toBe(true);
    });

    it('should unlock century club at 100 points', () => {
      // Award 100 points
      dopboost.awardPoints('test_user', 'Bulk award', 100);

      const achievements = dopboost.getAchievements('test_user');
      expect(achievements.some(a => a.id === 'points_100')).toBe(true);
    });
  });
});

describe('Attention Inference: Event Recording', () => {
  let db: ReturnType<typeof getTestDb>;
  let analyzer: AttentionAnalyzer;

  beforeEach(() => {
    resetTestDb();
    db = getTestDb();
    analyzer = new AttentionAnalyzer(db);
    createTestUserProfile(db, { id: 'test_user', name: 'Test User' });
  });

  afterAll(() => {
    closeTestDb();
  });

  it('should record activity events', () => {
    const eventId = analyzer.recordEvent({
      userId: 'test_user',
      timestamp: new Date().toISOString(),
      eventType: 'app_switch',
      appName: 'VS Code',
      durationMs: 5000,
    });

    expect(eventId).toBeDefined();

    const row = db.prepare('SELECT * FROM attention_events WHERE id = ?').get(eventId) as any;
    expect(row.app_name).toBe('VS Code');
    expect(row.duration_ms).toBe(5000);
  });

  it('should record events with metadata', () => {
    const eventId = analyzer.recordEvent({
      userId: 'test_user',
      timestamp: new Date().toISOString(),
      eventType: 'tab_switch',
      appName: 'Chrome',
      metadata: { tabCount: 15, url: 'https://example.com' },
    });

    const row = db.prepare('SELECT * FROM attention_events WHERE id = ?').get(eventId) as any;
    const metadata = JSON.parse(row.metadata_json);
    expect(metadata.tabCount).toBe(15);
  });
});

describe('Attention Inference: Snapshot Persistence', () => {
  let db: ReturnType<typeof getTestDb>;
  let analyzer: AttentionAnalyzer;

  beforeEach(() => {
    resetTestDb();
    db = getTestDb();
    analyzer = new AttentionAnalyzer(db);
    createTestUserProfile(db, { id: 'test_user', name: 'Test User' });
  });

  afterAll(() => {
    closeTestDb();
  });

  it('should save and retrieve attention snapshots', () => {
    simulateFocusedActivity(db, 'test_user');

    const snapshot = analyzer.getAttentionState('test_user');
    analyzer.saveSnapshot('test_user', snapshot);

    const history = analyzer.getAttentionHistory('test_user', 1);
    expect(history).toHaveLength(1);
    expect(history[0].state).toBe('focused');
  });

  it('should retrieve history ordered by timestamp', () => {
    // Save multiple snapshots
    for (let i = 0; i < 3; i++) {
      simulateFocusedActivity(db, 'test_user');
      const snapshot = analyzer.getAttentionState('test_user');
      snapshot.timestamp = new Date(Date.now() - i * 60 * 60 * 1000).toISOString();
      analyzer.saveSnapshot('test_user', snapshot);
    }

    const history = analyzer.getAttentionHistory('test_user', 24);
    expect(history.length).toBeGreaterThanOrEqual(3);

    // Should be in descending order
    for (let i = 1; i < history.length; i++) {
      expect(new Date(history[i - 1].timestamp).getTime())
        .toBeGreaterThanOrEqual(new Date(history[i].timestamp).getTime());
    }
  });
});

describe('Attention Inference: Metrics Calculation', () => {
  let db: ReturnType<typeof getTestDb>;
  let analyzer: AttentionAnalyzer;

  beforeEach(() => {
    resetTestDb();
    db = getTestDb();
    analyzer = new AttentionAnalyzer(db);
    createTestUserProfile(db, { id: 'test_user', name: 'Test User' });
  });

  afterAll(() => {
    closeTestDb();
  });

  it('should calculate switch frequency correctly', () => {
    const now = new Date();
    // Create 10 switches over 15 minutes = ~0.67 switches/min
    for (let i = 0; i < 10; i++) {
      createTestActivityEvent(db, {
        userId: 'test_user',
        timestamp: new Date(now.getTime() - i * 1.5 * 60 * 1000).toISOString(),
        eventType: 'app_switch',
        appName: `App${i}`,
      });
    }

    const snapshot = analyzer.getAttentionState('test_user');
    expect(snapshot.metrics.switchFrequency).toBeCloseTo(10 / 15, 0);
  });

  it('should calculate average dwell time', () => {
    const now = new Date();
    const dwellTimes = [5 * 60 * 1000, 10 * 60 * 1000, 15 * 60 * 1000]; // 5, 10, 15 min

    for (let i = 0; i < dwellTimes.length; i++) {
      createTestActivityEvent(db, {
        userId: 'test_user',
        timestamp: new Date(now.getTime() - i * 5 * 60 * 1000).toISOString(),
        eventType: 'app_switch',
        appName: `App${i}`,
        durationMs: dwellTimes[i],
      });
    }

    const snapshot = analyzer.getAttentionState('test_user');
    const expectedAvg = dwellTimes.reduce((a, b) => a + b, 0) / dwellTimes.length;
    expect(snapshot.metrics.avgDwellTime).toBeCloseTo(expectedAvg, -3);
  });

  it('should count context changes', () => {
    const now = new Date();
    const apps = ['VS Code', 'Chrome', 'Slack']; // 3 distinct contexts

    for (let i = 0; i < 6; i++) {
      createTestActivityEvent(db, {
        userId: 'test_user',
        timestamp: new Date(now.getTime() - i * 2 * 60 * 1000).toISOString(),
        eventType: 'app_switch',
        appName: apps[i % apps.length],
      });
    }

    const snapshot = analyzer.getAttentionState('test_user');
    expect(snapshot.metrics.contextChanges).toBe(3);
  });

  it('should calculate completion rate', () => {
    const now = new Date();

    // 4 starts (switches) and 2 completions = 50% completion rate
    for (let i = 0; i < 4; i++) {
      createTestActivityEvent(db, {
        userId: 'test_user',
        timestamp: new Date(now.getTime() - (i + 1) * 2 * 60 * 1000).toISOString(),
        eventType: 'app_switch',
        appName: 'VS Code',
      });
    }

    for (let i = 0; i < 2; i++) {
      createTestActivityEvent(db, {
        userId: 'test_user',
        timestamp: new Date(now.getTime() - i * 60 * 1000).toISOString(),
        eventType: 'task_complete',
        appName: 'VS Code',
      });
    }

    const snapshot = analyzer.getAttentionState('test_user');
    expect(snapshot.metrics.completionRate).toBeCloseTo(0.5, 1);
  });
});

describe('Attention Inference: ADHD Profile Integration', () => {
  let db: ReturnType<typeof getTestDb>;
  let system: ReturnType<typeof createAttentionSystem>;

  beforeEach(() => {
    resetTestDb();
    db = getTestDb();
    system = createAttentionSystem(db);
    createTestUserProfile(db, {
      id: 'ronald_adonyo',
      name: 'Ronald Adonyo',
      username: 'afrog33k',
      profile_json: JSON.stringify({
        mbti: 'INTJ',
        adhd: true,
        iqRange: '150-167',
      }),
    });
  });

  afterAll(() => {
    closeTestDb();
  });

  it('should handle ADHD scatter patterns appropriately', () => {
    simulateScatteredActivity(db, 'ronald_adonyo');

    const snapshot = system.analyzer.getAttentionState('ronald_adonyo');

    expect(snapshot.state).toBe('scattered');
    expect(snapshot.suggestedNudge?.type).toBe('task_refocus');
    expect(snapshot.suggestedNudge?.message).toContain('ONE thing');
  });

  it('should recognize hyperfocus in ADHD context', () => {
    simulateHyperfocus(db, 'ronald_adonyo');

    const snapshot = system.analyzer.getAttentionState('ronald_adonyo');

    expect(snapshot.state).toBe('hyperfocus');
    // Hyperfocus nudge is gentle, not interruptive
    expect(snapshot.suggestedNudge?.priority).toBe('low');
  });

  it('should provide appropriate support for crashed state', () => {
    simulateCrashedActivity(db, 'ronald_adonyo');

    const snapshot = system.analyzer.getAttentionState('ronald_adonyo');

    expect(snapshot.state).toBe('crashed');
    expect(snapshot.cognitiveLoad).toBe('overload');
    expect(snapshot.suggestedNudge?.type).toBe('break_suggestion');
  });
});
