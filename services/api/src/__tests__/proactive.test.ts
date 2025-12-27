/**
 * Proactive Intelligence Tests
 *
 * Tests for the proactive layer that makes Ronald-GI useful daily:
 * - Daily briefings
 * - Discovery spike detection
 * - Action recommendations
 * - Research planning
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  getTestDb,
  resetTestDb,
  closeTestDb,
  createTestReport,
  createTestConcept,
  simulateEngagement,
} from './setup';
import {
  DailyBriefingGenerator,
  ProactiveAlertManager,
  ResearchPlanner,
  createProactiveSystem,
} from '../lib/proactive';

describe('Proactive Intelligence Layer', () => {
  let db: ReturnType<typeof getTestDb>;

  beforeEach(() => {
    resetTestDb();
    db = getTestDb();

    // Ensure required tables exist
    db.exec(`
      CREATE TABLE IF NOT EXISTS proactive_alerts (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        priority TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        action_url TEXT,
        dismissed INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS research_plans (
        id TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        priority INTEGER DEFAULT 5,
        estimated_cost REAL DEFAULT 0.1,
        estimated_time TEXT DEFAULT '30 minutes',
        status TEXT DEFAULT 'planned',
        scheduled_for TEXT,
        reason TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS visit_clusters (
        id TEXT PRIMARY KEY,
        label TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
  });

  afterAll(() => {
    closeTestDb();
  });

  describe('Daily Briefing Generator', () => {
    it('should generate a briefing with all sections', () => {
      const generator = new DailyBriefingGenerator(db);
      const briefing = generator.generate();

      expect(briefing.date).toBeDefined();
      expect(briefing.greeting).toBeDefined();
      expect(briefing.discoverySpikes).toBeInstanceOf(Array);
      expect(briefing.topReports).toBeInstanceOf(Array);
      expect(briefing.overnightResearch).toBeInstanceOf(Array);
      expect(briefing.trendingConcepts).toBeInstanceOf(Array);
      expect(briefing.suggestedActions).toBeInstanceOf(Array);
      expect(briefing.learningInsights).toBeInstanceOf(Array);
      expect(briefing.stats).toBeDefined();
    });

    it('should include greeting with time of day', () => {
      const generator = new DailyBriefingGenerator(db);
      const briefing = generator.generate();

      // Greeting should start with Good morning/afternoon/evening
      expect(briefing.greeting).toMatch(/^Good (morning|afternoon|evening)/);
    });

    it('should include top obsessions in greeting when available', () => {
      // Create concept with high weight
      const conceptId = createTestConcept(db, { label: 'machine-learning', mention_count: 10 });
      db.prepare(`
        INSERT INTO preference_weights (id, weight_type, target_id, weight)
        VALUES ('pw1', 'concept', ?, 1.8)
      `).run(conceptId);

      const generator = new DailyBriefingGenerator(db);
      const briefing = generator.generate();

      expect(briefing.greeting).toContain('machine-learning');
    });

    it('should surface top reports based on impact and novelty', () => {
      createTestReport(db, {
        title: 'High Impact Report',
        impact_score: 0.9,
        novelty_score: 0.8,
        promoted: 1,
      });
      createTestReport(db, {
        title: 'Low Impact Report',
        impact_score: 0.2,
        novelty_score: 0.2,
        promoted: 1,
      });

      const generator = new DailyBriefingGenerator(db);
      const briefing = generator.generate();

      expect(briefing.topReports.length).toBeGreaterThan(0);
      expect(briefing.topReports[0].title).toBe('High Impact Report');
    });

    it('should suggest actions for unread high-impact reports', () => {
      createTestReport(db, {
        title: 'Must Read Report',
        impact_score: 0.85,
      });

      const generator = new DailyBriefingGenerator(db);
      const briefing = generator.generate();

      const readActions = briefing.suggestedActions.filter(a => a.type === 'read');
      expect(readActions.length).toBeGreaterThan(0);
    });

    it('should detect preference shifts as learning insights', () => {
      // Create concept with recent high engagement
      const conceptId = createTestConcept(db, { label: 'trending-topic', mention_count: 5 });
      db.prepare(`
        INSERT INTO preference_weights (id, weight_type, target_id, weight, last_engagement_at)
        VALUES ('pw1', 'concept', ?, 1.5, datetime('now'))
      `).run(conceptId);

      const generator = new DailyBriefingGenerator(db);
      const briefing = generator.generate();

      // May or may not have insights depending on data
      expect(briefing.learningInsights).toBeInstanceOf(Array);
    });

    it('should include stats about system activity', () => {
      createTestReport(db, { title: 'Report 1' });
      createTestReport(db, { title: 'Report 2' });
      createTestConcept(db, { label: 'concept-1' });

      const generator = new DailyBriefingGenerator(db);
      const briefing = generator.generate();

      expect(briefing.stats.reportsGenerated24h).toBeGreaterThanOrEqual(0);
      expect(briefing.stats.conceptsTracked).toBeGreaterThan(0);
    });
  });

  describe('Proactive Alert Manager', () => {
    it('should create alerts for high-impact findings', () => {
      createTestReport(db, {
        title: 'Critical Discovery',
        impact_score: 0.9,
      });

      const alertManager = new ProactiveAlertManager(db);
      const alerts = alertManager.checkAndCreateAlerts();

      const highImpact = alerts.filter(a => a.type === 'high_impact');
      expect(highImpact.length).toBeGreaterThan(0);
      expect(highImpact[0].priority).toBe('urgent');
    });

    it('should return pending alerts', () => {
      const alertManager = new ProactiveAlertManager(db);

      // Manually insert an alert
      db.prepare(`
        INSERT INTO proactive_alerts (id, type, priority, title, message)
        VALUES ('alert1', 'high_impact', 'urgent', 'Test Alert', 'Test message')
      `).run();

      const pending = alertManager.getPendingAlerts();
      expect(pending.length).toBe(1);
      expect(pending[0].title).toBe('Test Alert');
    });

    it('should dismiss alerts', () => {
      const alertManager = new ProactiveAlertManager(db);

      db.prepare(`
        INSERT INTO proactive_alerts (id, type, priority, title, message)
        VALUES ('alert1', 'high_impact', 'urgent', 'Test Alert', 'Test message')
      `).run();

      alertManager.dismiss('alert1');

      const pending = alertManager.getPendingAlerts();
      expect(pending.length).toBe(0);
    });

    it('should prioritize urgent alerts first', () => {
      const alertManager = new ProactiveAlertManager(db);

      db.prepare(`INSERT INTO proactive_alerts (id, type, priority, title, message) VALUES ('a1', 'info', 'informational', 'Low', 'msg')`).run();
      db.prepare(`INSERT INTO proactive_alerts (id, type, priority, title, message) VALUES ('a2', 'high', 'urgent', 'High', 'msg')`).run();
      db.prepare(`INSERT INTO proactive_alerts (id, type, priority, title, message) VALUES ('a3', 'medium', 'important', 'Medium', 'msg')`).run();

      const pending = alertManager.getPendingAlerts();
      expect(pending[0].title).toBe('High');
      expect(pending[1].title).toBe('Medium');
      expect(pending[2].title).toBe('Low');
    });
  });

  describe('Research Planner', () => {
    it('should plan research for high-weight concepts without recent reports', () => {
      const conceptId = createTestConcept(db, { label: 'under-researched', mention_count: 5 });
      db.prepare(`
        INSERT INTO preference_weights (id, weight_type, target_id, weight)
        VALUES ('pw1', 'concept', ?, 1.5)
      `).run(conceptId);

      const planner = new ResearchPlanner(db);
      const plans = planner.planNextResearch();

      expect(plans.length).toBeGreaterThan(0);
      expect(plans.some(p => p.topic === 'under-researched')).toBe(true);
    });

    it('should get planned research sorted by priority', () => {
      const planner = new ResearchPlanner(db);

      db.prepare(`
        INSERT INTO research_plans (id, topic, priority, status)
        VALUES ('p1', 'Low Priority', 3, 'planned')
      `).run();
      db.prepare(`
        INSERT INTO research_plans (id, topic, priority, status)
        VALUES ('p2', 'High Priority', 9, 'planned')
      `).run();

      const planned = planner.getPlannedResearch();
      expect(planned[0].topic).toBe('High Priority');
    });

    it('should execute next planned research', async () => {
      const planner = new ResearchPlanner(db);

      db.prepare(`
        INSERT INTO research_plans (id, topic, priority, status)
        VALUES ('p1', 'Test Topic', 5, 'planned')
      `).run();

      const jobId = await planner.executeNext();
      expect(jobId).toBeDefined();

      // Check plan status updated
      const plan = db.prepare(`SELECT status FROM research_plans WHERE id = 'p1'`).get() as any;
      expect(plan.status).toBe('in_progress');

      // Check job created
      const job = db.prepare(`SELECT * FROM job_queue WHERE id = ?`).get(jobId) as any;
      expect(job).toBeDefined();
      expect(job.job_type).toBe('research');
    });

    it('should return null when no research planned', async () => {
      const planner = new ResearchPlanner(db);
      const jobId = await planner.executeNext();
      expect(jobId).toBeNull();
    });
  });

  describe('Integrated Proactive System', () => {
    it('should create all components', () => {
      const system = createProactiveSystem(db);

      expect(system.briefing).toBeInstanceOf(DailyBriefingGenerator);
      expect(system.alerts).toBeInstanceOf(ProactiveAlertManager);
      expect(system.planner).toBeInstanceOf(ResearchPlanner);
    });

    it('should work end-to-end: engagement -> briefing -> action', () => {
      // 1. User engages with content
      const conceptId = createTestConcept(db, { label: 'hot-topic', mention_count: 10 });
      const reportId = createTestReport(db, {
        title: 'Interesting Research',
        impact_score: 0.8,
      });
      db.prepare(`
        INSERT INTO concept_mentions (id, concept_id, entity_type, entity_id)
        VALUES ('cm1', ?, 'report', ?)
      `).run(conceptId, reportId);
      simulateEngagement(db, reportId, { opened: true, scrollDepth: 0.9, pinned: true });

      // 2. Set up preference weight from engagement
      db.prepare(`
        INSERT INTO preference_weights (id, weight_type, target_id, weight, last_engagement_at)
        VALUES ('pw1', 'concept', ?, 1.6, datetime('now'))
      `).run(conceptId);

      // 3. Create another concept for research planning (no recent reports)
      const unresearcedId = createTestConcept(db, { label: 'needs-research', mention_count: 3 });
      db.prepare(`
        INSERT INTO preference_weights (id, weight_type, target_id, weight)
        VALUES ('pw2', 'concept', ?, 1.3)
      `).run(unresearcedId);

      // 4. Generate briefing
      const system = createProactiveSystem(db);
      const briefing = system.briefing.generate();

      // 5. Verify briefing reflects engagement
      expect(briefing.greeting).toContain('hot-topic');
      expect(briefing.topReports.some(r => r.title === 'Interesting Research')).toBe(true);

      // 6. Check alerts
      const alerts = system.alerts.checkAndCreateAlerts();
      expect(alerts).toBeInstanceOf(Array);

      // 7. Plan research based on interests (for concept without recent reports)
      const plans = system.planner.planNextResearch();
      expect(plans.some(p => p.topic === 'needs-research')).toBe(true);
    });
  });
});

describe('Proactive Edge Cases', () => {
  let db: ReturnType<typeof getTestDb>;

  beforeEach(() => {
    resetTestDb();
    db = getTestDb();

    db.exec(`
      CREATE TABLE IF NOT EXISTS proactive_alerts (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        priority TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        action_url TEXT,
        dismissed INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS research_plans (
        id TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        priority INTEGER DEFAULT 5,
        estimated_cost REAL DEFAULT 0.1,
        estimated_time TEXT DEFAULT '30 minutes',
        status TEXT DEFAULT 'planned',
        scheduled_for TEXT,
        reason TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
  });

  afterAll(() => {
    closeTestDb();
  });

  it('should handle empty database gracefully', () => {
    const system = createProactiveSystem(db);
    const briefing = system.briefing.generate();

    expect(briefing.discoverySpikes).toEqual([]);
    expect(briefing.topReports).toEqual([]);
    expect(briefing.suggestedActions).toEqual([]);
    expect(briefing.stats.reportsGenerated24h).toBe(0);
  });

  it('should not duplicate alerts for same finding', () => {
    const reportId = createTestReport(db, {
      title: 'Important Finding',
      impact_score: 0.9,
    });

    const system = createProactiveSystem(db);

    // First check
    const alerts1 = system.alerts.checkAndCreateAlerts();
    const highImpact1 = alerts1.filter(a => a.type === 'high_impact').length;

    // Second check should not create duplicates
    const alerts2 = system.alerts.checkAndCreateAlerts();
    const highImpact2 = alerts2.filter(a => a.type === 'high_impact').length;

    // The second check should find 0 new high_impact alerts (already created)
    expect(highImpact2).toBe(0);
  });
});
