/**
 * Test Setup for Ronald-GI API
 *
 * The essence of Ronald-GI:
 * - Local-first autonomous research assistant
 * - Learns from implicit engagement (telemetry) and explicit feedback
 * - Evolving concept map with merge/kill lifecycle
 * - Adaptive stopping policy based on satisfaction prediction
 * - Discovery spike detection from browsing behavior
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join } from 'path';

let testDb: Database.Database | null = null;

export function getTestDb(): Database.Database {
  if (!testDb) {
    testDb = new Database(':memory:');
    testDb.pragma('foreign_keys = ON');

    // Load schema
    const schemaPath = join(__dirname, '../../../../migrations/001_initial_schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');
    testDb.exec(schema);

    // Load concept drift migration
    try {
      const driftPath = join(__dirname, '../../../../migrations/002_concept_drift.sql');
      const drift = readFileSync(driftPath, 'utf-8');
      testDb.exec(drift);
    } catch (e) {
      // May not exist
    }

    // Create test_runs table
    testDb.exec(`
      CREATE TABLE IF NOT EXISTS test_runs (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        owner TEXT NOT NULL,
        repo TEXT NOT NULL,
        project_type TEXT,
        passed INTEGER DEFAULT 0,
        summary TEXT,
        total_duration_ms INTEGER,
        status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // Create BDI model tables
    testDb.exec(`
      -- User profiles
      CREATE TABLE IF NOT EXISTS user_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        username TEXT,
        email TEXT,
        location TEXT,
        bio TEXT,
        profile_json TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      -- BDI: Beliefs
      CREATE TABLE IF NOT EXISTS user_beliefs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        belief_type TEXT NOT NULL,
        subject TEXT NOT NULL,
        predicate TEXT,
        object TEXT,
        confidence REAL DEFAULT 0.8,
        source TEXT,
        evidence_json TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      -- BDI: Desires
      CREATE TABLE IF NOT EXISTS user_desires (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        desire_type TEXT NOT NULL,
        description TEXT NOT NULL,
        priority INTEGER DEFAULT 5,
        timeframe TEXT,
        status TEXT DEFAULT 'active',
        related_concepts TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      -- BDI: Intentions
      CREATE TABLE IF NOT EXISTS user_intentions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        intention_type TEXT NOT NULL,
        description TEXT NOT NULL,
        parent_desire_id TEXT,
        status TEXT DEFAULT 'planned',
        priority INTEGER DEFAULT 5,
        deadline TEXT,
        context_json TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      -- User skills
      CREATE TABLE IF NOT EXISTS user_skills (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        skill_name TEXT NOT NULL,
        category TEXT,
        proficiency_level TEXT,
        years_experience INTEGER,
        last_used_at TEXT,
        source TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      -- User work history
      CREATE TABLE IF NOT EXISTS user_work_history (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        company TEXT NOT NULL,
        role TEXT NOT NULL,
        description TEXT,
        start_date TEXT,
        end_date TEXT,
        technologies_json TEXT,
        achievements_json TEXT,
        source TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_beliefs_user ON user_beliefs(user_id);
      CREATE INDEX IF NOT EXISTS idx_beliefs_type ON user_beliefs(belief_type);
      CREATE INDEX IF NOT EXISTS idx_desires_user ON user_desires(user_id);
      CREATE INDEX IF NOT EXISTS idx_intentions_user ON user_intentions(user_id);
    `);

    // Create Attention Inference tables
    testDb.exec(`
      -- Activity events for attention tracking
      CREATE TABLE IF NOT EXISTS attention_events (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        timestamp TEXT DEFAULT (datetime('now')),
        event_type TEXT NOT NULL,
        app_name TEXT,
        url TEXT,
        title TEXT,
        duration_ms INTEGER,
        metadata_json TEXT
      );

      -- Attention state snapshots
      CREATE TABLE IF NOT EXISTS attention_snapshots (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        state TEXT NOT NULL,
        confidence REAL,
        activity_type TEXT,
        cognitive_load TEXT,
        metrics_json TEXT,
        timestamp TEXT DEFAULT (datetime('now'))
      );

      -- Nudge history
      CREATE TABLE IF NOT EXISTS nudge_history (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        nudge_type TEXT NOT NULL,
        message TEXT,
        priority TEXT,
        response TEXT,
        timestamp TEXT DEFAULT (datetime('now')),
        responded_at TEXT
      );

      -- DopBoost points
      CREATE TABLE IF NOT EXISTS dopboost_points (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        reason TEXT,
        points INTEGER,
        timestamp TEXT DEFAULT (datetime('now'))
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_attention_events_user ON attention_events(user_id);
      CREATE INDEX IF NOT EXISTS idx_attention_snapshots_user ON attention_snapshots(user_id);
      CREATE INDEX IF NOT EXISTS idx_nudge_history_user ON nudge_history(user_id);
    `);

    // Create Eval Framework tables
    testDb.exec(`
      -- Prediction evaluations
      CREATE TABLE IF NOT EXISTS eval_predictions (
        id TEXT PRIMARY KEY,
        prediction_id TEXT NOT NULL UNIQUE,
        feedback TEXT,
        context_json TEXT,
        timestamp TEXT DEFAULT (datetime('now'))
      );

      -- Intervention evaluations
      CREATE TABLE IF NOT EXISTS eval_interventions (
        id TEXT PRIMARY KEY,
        intervention_id TEXT NOT NULL,
        outcome TEXT,
        outcome_score INTEGER,
        details TEXT,
        timestamp TEXT DEFAULT (datetime('now'))
      );

      -- User satisfaction
      CREATE TABLE IF NOT EXISTS eval_satisfaction (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        score INTEGER,
        context TEXT,
        timestamp TEXT DEFAULT (datetime('now'))
      );

      -- Interest validation (did user actually like the report?)
      CREATE TABLE IF NOT EXISTS eval_interest_validation (
        id TEXT PRIMARY KEY,
        report_id TEXT NOT NULL,
        actually_interested INTEGER,
        predicted_interest REAL,
        timestamp TEXT DEFAULT (datetime('now'))
      );

      -- Attention validation (was system correct about attention state?)
      CREATE TABLE IF NOT EXISTS eval_attention_validation (
        id TEXT PRIMARY KEY,
        snapshot_id TEXT NOT NULL,
        predicted_state TEXT,
        actual_state TEXT,
        correct INTEGER,
        timestamp TEXT DEFAULT (datetime('now'))
      );

      -- A/B Tests
      CREATE TABLE IF NOT EXISTS ab_tests (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        variants_json TEXT,
        target_metric TEXT,
        status TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS ab_test_assignments (
        id TEXT PRIMARY KEY,
        test_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        variant TEXT NOT NULL,
        assigned_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS ab_test_metrics (
        id TEXT PRIMARY KEY,
        test_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        variant TEXT NOT NULL,
        metric_value REAL,
        recorded_at TEXT DEFAULT (datetime('now'))
      );
    `);
  }
  return testDb;
}

export function resetTestDb(): void {
  if (testDb) {
    testDb.close();
    testDb = null;
  }
  getTestDb();
}

export function closeTestDb(): void {
  if (testDb) {
    testDb.close();
    testDb = null;
  }
}

// ============================================
// TEST HELPERS - Simulating Ronald-GI Behaviors
// ============================================

function randomId(): string {
  return Math.random().toString(36).substring(2, 15) +
         Math.random().toString(36).substring(2, 15);
}

/** Create a test report with realistic defaults */
export function createTestReport(db: Database.Database, overrides: Partial<{
  id: string;
  type: string;
  title: string;
  summary: string;
  decision: string;
  findings_json: string;
  evidence_json: string;
  ui_blocks_json: string;
  concept_ids_json: string;
  impact_score: number;
  novelty_score: number;
  relevance_score: number;
  pinned: number;
  promoted: number;
  cost_tokens: number;
  cost_dollars: number;
}> = {}) {
  const id = overrides.id || randomId();
  db.prepare(`
    INSERT INTO reports (
      id, type, title, summary, decision, findings_json, evidence_json,
      ui_blocks_json, concept_ids_json, impact_score, novelty_score,
      relevance_score, pinned, promoted, cost_tokens, cost_dollars
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.type || 'research_brief',
    overrides.title || 'Test Report',
    overrides.summary || 'Test summary',
    overrides.decision || null,
    overrides.findings_json || '[]',
    overrides.evidence_json || '[]',
    overrides.ui_blocks_json || '[]',
    overrides.concept_ids_json || '[]',
    overrides.impact_score ?? 0.5,
    overrides.novelty_score ?? 0.5,
    overrides.relevance_score ?? 0.5,
    overrides.pinned ?? 0,
    overrides.promoted ?? 1,
    overrides.cost_tokens ?? 1000,
    overrides.cost_dollars ?? 0.01
  );
  return id;
}

/** Create a concept with optional embedding simulation */
export function createTestConcept(db: Database.Database, overrides: Partial<{
  id: string;
  label: string;
  description: string;
  mention_count: number;
  active: number;
}> = {}) {
  const id = overrides.id || randomId();
  db.prepare(`
    INSERT INTO concepts (id, label, description, mention_count, active)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.label || `concept_${id.slice(0, 8)}`,
    overrides.description || 'Test concept',
    overrides.mention_count ?? 0,
    overrides.active ?? 1
  );
  return id;
}

/** Simulate user engagement with a report */
export function simulateEngagement(db: Database.Database, reportId: string, behavior: {
  opened?: boolean;
  scrollDepth?: number;
  dwellMs?: number;
  clicked?: boolean;
  pinned?: boolean;
}) {
  if (behavior.opened) {
    db.prepare(`INSERT INTO telemetry (id, report_id, event_type, event_data_json) VALUES (?, ?, 'open', '{}')`).run(randomId(), reportId);
  }
  if (behavior.scrollDepth !== undefined) {
    db.prepare(`INSERT INTO telemetry (id, report_id, event_type, event_data_json) VALUES (?, ?, 'scroll', ?)`).run(
      randomId(), reportId, JSON.stringify({ depth: behavior.scrollDepth })
    );
  }
  if (behavior.clicked) {
    db.prepare(`INSERT INTO telemetry (id, report_id, event_type, event_data_json) VALUES (?, ?, 'click', '{}')`).run(randomId(), reportId);
  }
  if (behavior.dwellMs !== undefined) {
    db.prepare(`INSERT INTO telemetry (id, report_id, event_type, event_data_json) VALUES (?, ?, 'close', ?)`).run(
      randomId(), reportId, JSON.stringify({ dwell_ms: behavior.dwellMs })
    );
  }
  if (behavior.pinned) {
    db.prepare(`INSERT INTO telemetry (id, report_id, event_type, event_data_json) VALUES (?, ?, 'pin', '{}')`).run(randomId(), reportId);
    db.prepare(`UPDATE reports SET pinned = 1 WHERE id = ?`).run(reportId);
  }
}

/** Simulate explicit feedback */
export function submitFeedback(db: Database.Database, reportId: string, action: 'useful' | 'not_useful' | 'more_depth' | 'kill_thread') {
  db.prepare(`INSERT INTO feedback (id, report_id, action) VALUES (?, ?, ?)`).run(randomId(), reportId, action);

  // Update UI action stats
  db.prepare(`UPDATE ui_action_stats SET shown_count = shown_count + 1 WHERE action = ?`).run(action);
  db.prepare(`UPDATE ui_action_stats SET clicked_count = clicked_count + 1 WHERE action = ?`).run(action);
}

/** Calculate satisfaction score based on engagement */
export function calculateSatisfaction(db: Database.Database, reportId: string): number {
  const telemetry = db.prepare(`SELECT * FROM telemetry WHERE report_id = ?`).all(reportId) as any[];
  const feedback = db.prepare(`SELECT * FROM feedback WHERE report_id = ?`).all(reportId) as any[];
  const report = db.prepare(`SELECT pinned FROM reports WHERE id = ?`).get(reportId) as any;

  let score = 0.3; // Base

  // Pinned = strong positive signal
  if (report?.pinned) score += 0.3;

  // Useful feedback = positive
  if (feedback.some(f => f.action === 'useful')) score += 0.2;
  if (feedback.some(f => f.action === 'not_useful')) score -= 0.3;

  // Deep scroll = engaged
  const scrollEvents = telemetry.filter(t => t.event_type === 'scroll');
  if (scrollEvents.length > 0) {
    const maxDepth = Math.max(...scrollEvents.map(s => JSON.parse(s.event_data_json).depth || 0));
    score += maxDepth * 0.1;
  }

  // Click = engaged
  if (telemetry.some(t => t.event_type === 'click')) score += 0.1;

  // Long dwell = engaged
  const closeEvent = telemetry.find(t => t.event_type === 'close');
  if (closeEvent) {
    const dwellMs = JSON.parse(closeEvent.event_data_json).dwell_ms || 0;
    if (dwellMs > 10000) score += 0.1;
  }

  return Math.max(0, Math.min(1, score));
}

/** Simulate concept similarity for merge detection */
export function createSimilarConcepts(db: Database.Database, label1: string, label2: string, similarity: number) {
  const id1 = createTestConcept(db, { label: label1, mention_count: 5 });
  const id2 = createTestConcept(db, { label: label2, mention_count: 3 });

  // Insert into nearest_concepts with distance = 1 - similarity
  db.prepare(`
    INSERT INTO nearest_concepts (concept_id, neighbor_id, distance, rank)
    VALUES (?, ?, ?, 1)
  `).run(id1, id2, 1 - similarity);

  return { id1, id2 };
}

/** Check if stopping conditions are met */
export function checkStoppingPolicy(report: {
  cost_tokens: number;
  cost_dollars: number;
  findings_json: string;
  decision: string | null;
  summary: string | null;
}): { shouldStop: boolean; reason: string } {
  // Hard limits
  if (report.cost_tokens >= 50000) {
    return { shouldStop: true, reason: 'max_tokens' };
  }
  if (report.cost_dollars >= 0.50) {
    return { shouldStop: true, reason: 'max_dollars' };
  }

  // Completeness check
  const findings = JSON.parse(report.findings_json || '[]');
  let completeness = 0;
  if (report.summary) completeness += 0.25;
  if (report.decision) completeness += 0.25;
  if (findings.length > 0) completeness += 0.25;
  if (findings.length >= 3) completeness += 0.25;

  if (completeness >= 0.8) {
    return { shouldStop: true, reason: 'complete' };
  }

  return { shouldStop: false, reason: 'continue' };
}

// ============================================
// BDI MODEL HELPERS
// ============================================

/** Create a test user profile */
export function createTestUserProfile(db: Database.Database, overrides: Partial<{
  id: string;
  name: string;
  username: string;
  profile_json: string;
}> = {}) {
  const id = overrides.id || 'test_user';
  db.prepare(`
    INSERT OR REPLACE INTO user_profiles (id, name, username, profile_json)
    VALUES (?, ?, ?, ?)
  `).run(
    id,
    overrides.name || 'Test User',
    overrides.username || 'testuser',
    overrides.profile_json || '{}'
  );
  return id;
}

/** Create a test belief */
export function createTestBelief(db: Database.Database, overrides: Partial<{
  id: string;
  userId: string;
  type: string;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  source: string;
}> = {}) {
  const id = overrides.id || randomId();
  db.prepare(`
    INSERT INTO user_beliefs (id, user_id, belief_type, subject, predicate, object, confidence, source, evidence_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}')
  `).run(
    id,
    overrides.userId || 'test_user',
    overrides.type || 'interest',
    overrides.subject || 'user',
    overrides.predicate || 'is_interested_in',
    overrides.object || 'test_topic',
    overrides.confidence ?? 0.8,
    overrides.source || 'observed'
  );
  return id;
}

/** Create a test desire */
export function createTestDesire(db: Database.Database, overrides: Partial<{
  id: string;
  userId: string;
  type: string;
  description: string;
  priority: number;
  timeframe: string;
  status: string;
  relatedConcepts: string[];
}> = {}) {
  const id = overrides.id || randomId();
  db.prepare(`
    INSERT INTO user_desires (id, user_id, desire_type, description, priority, timeframe, status, related_concepts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.userId || 'test_user',
    overrides.type || 'goal',
    overrides.description || 'Test desire',
    overrides.priority ?? 5,
    overrides.timeframe || 'short-term',
    overrides.status || 'active',
    JSON.stringify(overrides.relatedConcepts || [])
  );
  return id;
}

/** Create a test intention */
export function createTestIntention(db: Database.Database, overrides: Partial<{
  id: string;
  userId: string;
  type: string;
  description: string;
  parentDesireId: string;
  status: string;
  priority: number;
  context: Record<string, any>;
}> = {}) {
  const id = overrides.id || randomId();
  db.prepare(`
    INSERT INTO user_intentions (id, user_id, intention_type, description, parent_desire_id, status, priority, context_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.userId || 'test_user',
    overrides.type || 'task',
    overrides.description || 'Test intention',
    overrides.parentDesireId || null,
    overrides.status || 'planned',
    overrides.priority ?? 5,
    JSON.stringify(overrides.context || {})
  );
  return id;
}

/** Simulate ADHD context for a user */
export function addADHDContext(db: Database.Database, userId: string) {
  createTestBelief(db, {
    userId,
    type: 'context',
    subject: userId,
    predicate: 'has',
    object: 'ADHD',
    confidence: 0.95,
    source: 'stated',
  });

  createTestBelief(db, {
    userId,
    type: 'context',
    subject: userId,
    predicate: 'experiences',
    object: 'scattered attention',
    confidence: 0.9,
    source: 'stated',
  });
}

/** Create high cognitive load scenario */
export function createHighCognitiveLoad(db: Database.Database, userId: string) {
  // Create multiple in-progress high-priority intentions
  for (let i = 0; i < 4; i++) {
    createTestIntention(db, {
      userId,
      description: `High priority task ${i + 1}`,
      status: 'in_progress',
      priority: 8 + (i % 2),
    });
  }
}

// ============================================
// ATTENTION INFERENCE HELPERS
// ============================================

/** Create a test activity event */
export function createTestActivityEvent(db: Database.Database, overrides: Partial<{
  id: string;
  userId: string;
  timestamp: string;
  eventType: string;
  appName: string;
  url: string;
  title: string;
  durationMs: number;
  metadata: Record<string, any>;
}> = {}) {
  const id = overrides.id || randomId();
  db.prepare(`
    INSERT INTO attention_events
    (id, user_id, timestamp, event_type, app_name, url, title, duration_ms, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.userId || 'test_user',
    overrides.timestamp || new Date().toISOString(),
    overrides.eventType || 'app_switch',
    overrides.appName || null,
    overrides.url || null,
    overrides.title || null,
    overrides.durationMs || null,
    JSON.stringify(overrides.metadata || {})
  );
  return id;
}

/** Simulate focused activity pattern */
export function simulateFocusedActivity(db: Database.Database, userId: string) {
  const now = new Date();

  // Few switches, long dwell times, completions
  for (let i = 0; i < 3; i++) {
    const timestamp = new Date(now.getTime() - (15 - i * 5) * 60 * 1000).toISOString();
    createTestActivityEvent(db, {
      userId,
      timestamp,
      eventType: 'app_switch',
      appName: 'VS Code',
      durationMs: 10 * 60 * 1000, // 10 min dwell
    });
  }

  // Add task completion
  createTestActivityEvent(db, {
    userId,
    timestamp: new Date(now.getTime() - 2 * 60 * 1000).toISOString(),
    eventType: 'task_complete',
    appName: 'VS Code',
  });
}

/** Simulate scattered activity pattern */
export function simulateScatteredActivity(db: Database.Database, userId: string) {
  const now = new Date();

  // Many switches, short dwell times
  for (let i = 0; i < 20; i++) {
    const timestamp = new Date(now.getTime() - (15 - i * 0.75) * 60 * 1000).toISOString();
    const apps = ['Chrome', 'Slack', 'VS Code', 'Mail', 'Terminal'];

    createTestActivityEvent(db, {
      userId,
      timestamp,
      eventType: i % 3 === 0 ? 'tab_switch' : 'app_switch',
      appName: apps[i % apps.length],
      durationMs: 30 * 1000, // 30 sec dwell
      metadata: { tabCount: 15 + i },
    });
  }
}

/** Simulate crashed activity pattern */
export function simulateCrashedActivity(db: Database.Database, userId: string) {
  const now = new Date();

  // Very high switching, no completions
  for (let i = 0; i < 30; i++) {
    const timestamp = new Date(now.getTime() - (15 - i * 0.5) * 60 * 1000).toISOString();
    const apps = ['Chrome', 'Twitter', 'Reddit', 'YouTube', 'Slack'];

    createTestActivityEvent(db, {
      userId,
      timestamp,
      eventType: 'tab_switch',
      appName: apps[i % apps.length],
      url: `https://${apps[i % apps.length].toLowerCase()}.com/page${i}`,
      durationMs: 10 * 1000, // 10 sec dwell
      metadata: { tabCount: 25 + i },
    });
  }
}

/** Simulate hyperfocus pattern */
export function simulateHyperfocus(db: Database.Database, userId: string) {
  const now = new Date();

  // Single long session
  createTestActivityEvent(db, {
    userId,
    timestamp: new Date(now.getTime() - 60 * 60 * 1000).toISOString(), // 1 hour ago
    eventType: 'app_switch',
    appName: 'VS Code',
    durationMs: 50 * 60 * 1000, // 50 min dwell
  });

  // One recent event to keep it active
  createTestActivityEvent(db, {
    userId,
    timestamp: new Date(now.getTime() - 2 * 60 * 1000).toISOString(),
    eventType: 'active',
    appName: 'VS Code',
    durationMs: 50 * 60 * 1000,
  });
}
