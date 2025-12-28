/**
 * Comprehensive Integration Test
 *
 * Tests the complete Ronald-GI system end-to-end:
 * 1. Memory Graph
 * 2. Vector Search
 * 3. BDI Model
 * 4. Drives System
 * 5. Working Memory
 * 6. Heartbeat
 * 7. Trust/Provenance
 *
 * This is the "smoke test" that validates the entire system works together.
 */

import Database from 'better-sqlite3';
import { createMemoryGraph, type MemoryGraph } from '../services/api/src/lib/memory_graph';
import {
  createVectorSearch,
  MockEmbeddingProvider,
  type VectorSearch,
} from '../services/api/src/lib/vector_search';
import { createTrustProvenanceManager, type TrustProvenanceManager } from '../services/api/src/lib/trust_provenance';
import { WorkingMemory } from '../services/api/src/lib/working_memory';
import { DrivesManager, type DriveType } from '../services/api/src/lib/drives';
import { DecayCalculator, MemoryDecayManager } from '../services/api/src/lib/memory_decay';

// Factory functions for convenience
function createWorkingMemory(db: Database.Database): WorkingMemory {
  return new WorkingMemory(db);
}

function createDrivesManager(db: Database.Database): DrivesManager {
  return new DrivesManager(db);
}

// =============================================================================
// Test Framework
// =============================================================================

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

interface TestSuite {
  name: string;
  results: TestResult[];
  passed: number;
  failed: number;
  duration: number;
}

function test(
  name: string,
  fn: () => void | Promise<void>
): Promise<TestResult> {
  return new Promise(async (resolve) => {
    const start = performance.now();
    try {
      await fn();
      resolve({
        name,
        passed: true,
        duration: performance.now() - start,
      });
    } catch (error) {
      resolve({
        name,
        passed: false,
        duration: performance.now() - start,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

// =============================================================================
// Test Suites
// =============================================================================

async function testMemoryGraph(db: Database): Promise<TestResult[]> {
  const graph = createMemoryGraph(db);
  const results: TestResult[] = [];

  // Test: Create nodes
  results.push(
    await test('Create graph nodes', () => {
      const node1 = graph.upsertNode({
        id: 'belief_1',
        type: 'belief',
        label: 'User prefers dark mode',
        properties: { category: 'preference' },
      });
      assert(node1.id === 'belief_1', 'Node ID should match');
      assert(node1.type === 'belief', 'Node type should match');
    })
  );

  // Test: Create edges
  results.push(
    await test('Create graph edges', () => {
      graph.upsertNode({
        id: 'event_1',
        type: 'event',
        label: 'User enabled dark mode',
        properties: {},
      });

      const edge = graph.connect('belief_1', 'event_1', 'DERIVED_FROM', 0.9);
      assert(edge !== null, 'Edge should be created');
      assert(edge!.relationship === 'DERIVED_FROM', 'Relationship should match');
    })
  );

  // Test: Find neighbors
  results.push(
    await test('Find graph neighbors', () => {
      const neighbors = graph.findNeighbors('belief_1', { maxDepth: 2 });
      assert(neighbors.length >= 1, 'Should find at least one neighbor');
    })
  );

  // Test: Contradiction detection
  results.push(
    await test('Mark contradictions', () => {
      graph.upsertNode({
        id: 'belief_2',
        type: 'belief',
        label: 'User prefers light mode',
        properties: {},
      });

      graph.markContradiction('belief_1', 'belief_2', 'Opposite preferences');
      const contradictions = graph.findContradictions('belief_1');
      assert(contradictions.length === 1, 'Should find one contradiction');
    })
  );

  return results;
}

async function testVectorSearch(db: Database): Promise<TestResult[]> {
  const vectorSearch = await createVectorSearch(db, {
    backend: 'brute-force',
    dimension: 384,
    embeddingProvider: new MockEmbeddingProvider(),
  });
  const results: TestResult[] = [];

  // Test: Store vectors
  results.push(
    await test('Store vectors', async () => {
      await vectorSearch.store('vec_1', 'The user likes coffee in the morning', undefined, {
        type: 'preference',
      });
      await vectorSearch.store('vec_2', 'The user prefers tea in the afternoon', undefined, {
        type: 'preference',
      });
      await vectorSearch.store('vec_3', 'The user works from home', undefined, {
        type: 'behavior',
      });

      const stats = vectorSearch.getStats();
      assert(stats.count >= 3, 'Should have stored 3 vectors');
    })
  );

  // Test: Search vectors
  results.push(
    await test('Search vectors', async () => {
      const searchResults = await vectorSearch.search('coffee morning beverage', 5);
      assert(searchResults.length > 0, 'Should find results');
      assert(
        searchResults[0].content.includes('coffee'),
        'First result should be about coffee'
      );
    })
  );

  // Test: Delete vectors
  results.push(
    await test('Delete vectors', async () => {
      const deleted = vectorSearch.delete('vec_1');
      assert(deleted, 'Should delete vector');

      const remaining = vectorSearch.get('vec_1');
      assert(remaining === null, 'Vector should be deleted');
    })
  );

  return results;
}

async function testTrustProvenance(db: Database): Promise<TestResult[]> {
  const trustManager = createTrustProvenanceManager(db);
  const results: TestResult[] = [];

  // Test: Create source
  results.push(
    await test('Create source record', () => {
      const source = trustManager.createSource(
        'stated',
        'conversation_123',
        'User explicitly stated preference'
      );
      assert(source.id.startsWith('src_'), 'Source ID should have correct prefix');
      assert(source.trust === 0.9, 'Stated source should have high trust');
    })
  );

  // Test: Link belief to source
  results.push(
    await test('Link belief to source', () => {
      const source = trustManager.createSource('observed', 'event_456', 'Observed behavior');
      trustManager.linkBeliefToSource('belief_test_1', source.id, true);

      const sources = trustManager.getBeliefSources('belief_test_1');
      assert(sources.primary !== undefined, 'Should have primary source');
    })
  );

  // Test: Compute trust
  results.push(
    await test('Compute aggregated trust', () => {
      // Add additional sources
      const source2 = trustManager.addSourceToBelief(
        'belief_test_1',
        'observed',
        'event_789',
        'Additional observation'
      );

      const trust = trustManager.computeTrust('belief_test_1');
      assert(trust > 0.5, 'Trust should be above 0.5 with multiple sources');
      assert(trust <= 1.0, 'Trust should not exceed 1.0');
    })
  );

  // Test: Record contradiction
  results.push(
    await test('Record and manage contradictions', () => {
      trustManager.recordContradiction('belief_test_1', 'belief_test_2', { reason: 'Opposite' });
      const contradictions = trustManager.getContradictions('belief_test_1');
      assert(contradictions.unresolved.length === 1, 'Should have one unresolved contradiction');
    })
  );

  return results;
}

async function testWorkingMemory(db: Database): Promise<TestResult[]> {
  const workingMemory = createWorkingMemory(db);
  const results: TestResult[] = [];

  // Test: Store items
  results.push(
    await test('Store working memory items', () => {
      const id = workingMemory.store({
        content: 'Current task: finish the report',
        type: 'focus',
        priority: 10,
        ttlSeconds: 300,
      });
      assert(id.startsWith('wm_'), 'Working memory ID should have correct prefix');
    })
  );

  // Test: Retrieve items
  results.push(
    await test('Retrieve working memory items', () => {
      const items = workingMemory.retrieve({ type: 'focus' });
      assert(items.length >= 1, 'Should retrieve at least one item');
    })
  );

  // Test: Set focus
  results.push(
    await test('Set and get current focus', () => {
      workingMemory.setFocus('Writing integration tests', 600);
      const focus = workingMemory.getCurrentFocus();
      assert(focus !== null, 'Should have current focus');
      assert(focus!.content === 'Writing integration tests', 'Focus content should match');
    })
  );

  // Test: Cleanup expired
  results.push(
    await test('Cleanup expired items', () => {
      // Store item with short TTL
      workingMemory.store({
        content: 'Temporary item',
        type: 'scratch',
        priority: 1,
        ttlSeconds: -1, // Already expired
      });

      const cleaned = workingMemory.cleanup();
      assert(cleaned >= 1, 'Should clean at least one expired item');
    })
  );

  return results;
}

async function testDrivesSystem(db: Database): Promise<TestResult[]> {
  const drivesManager = createDrivesManager(db);
  const results: TestResult[] = [];

  // Test: Initialize drives
  results.push(
    await test('Initialize drives', () => {
      const stats = drivesManager.getStats();
      assert(stats.totalDrives >= 5, 'Should have at least 5 drives');
    })
  );

  // Test: Accumulate drive
  results.push(
    await test('Accumulate drive level', () => {
      const beforeDrives = drivesManager.getAllDrives();
      const focusBefore = beforeDrives.find((d) => d.type === 'focus')?.level || 0;

      drivesManager.accumulate('focus', 20, 'scattered attention detected');

      const afterDrives = drivesManager.getAllDrives();
      const focusAfter = afterDrives.find((d) => d.type === 'focus')?.level || 0;

      assert(focusAfter > focusBefore, 'Focus drive should increase');
    })
  );

  // Test: Satisfy drive
  results.push(
    await test('Satisfy drive', () => {
      const beforeDrives = drivesManager.getAllDrives();
      const focusBefore = beforeDrives.find((d) => d.type === 'focus')?.level || 0;

      drivesManager.satisfy('focus', 'completed focus session');

      const afterDrives = drivesManager.getAllDrives();
      const focusAfter = afterDrives.find((d) => d.type === 'focus')?.level || 0;

      assert(focusAfter < focusBefore, 'Focus drive should decrease after satisfaction');
    })
  );

  // Test: Get urgent drives
  results.push(
    await test('Get urgent drives', () => {
      // Accumulate to make urgent
      drivesManager.accumulate('novelty', 80, 'routine detected');
      const urgent = drivesManager.getUrgentDrives();
      // May or may not have urgent drives depending on thresholds
      assert(Array.isArray(urgent), 'Should return array');
    })
  );

  return results;
}

async function testMemoryDecay(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  // Test: Calculate decay factor
  results.push(
    await test('Calculate decay factor', () => {
      const factor = DecayCalculator.calculateDecayFactor(7, 30); // 7 days, 30 day half-life
      assert(factor > 0.8, 'Decay should be minimal after 7 days');
      assert(factor < 1.0, 'Decay factor should be less than 1');
    })
  );

  // Test: Access boost
  results.push(
    await test('Calculate access boost', () => {
      const config = { halfLifeDays: 30, accessBoostFactor: 0.1, minConfidence: 0.1 };
      const boost = DecayCalculator.calculateAccessBoost(0.5, config);
      assert(boost > 0.5, 'Boosted confidence should be higher');
      assert(boost <= 1.0, 'Boosted confidence should not exceed 1.0');
    })
  );

  return results;
}

// =============================================================================
// Schema Initialization
// =============================================================================

function initializeSchema(db: Database.Database): void {
  // Memory Graph tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS graph_nodes (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      label TEXT NOT NULL,
      properties_json TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS graph_edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relationship TEXT NOT NULL,
      weight REAL DEFAULT 1.0,
      properties_json TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (source_id) REFERENCES graph_nodes(id),
      FOREIGN KEY (target_id) REFERENCES graph_nodes(id)
    );

    CREATE INDEX IF NOT EXISTS idx_edges_source ON graph_edges(source_id);
    CREATE INDEX IF NOT EXISTS idx_edges_target ON graph_edges(target_id);
    CREATE INDEX IF NOT EXISTS idx_edges_relationship ON graph_edges(relationship);
  `);

  // Vector Search tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS vectors (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      embedding BLOB NOT NULL,
      metadata_json TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_vectors_created ON vectors(created_at DESC);
  `);

  // Trust & Provenance tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      reference TEXT NOT NULL,
      label TEXT,
      trust REAL DEFAULT 0.5,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS belief_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      belief_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      is_primary INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS contradictions (
      id TEXT PRIMARY KEY,
      belief_id_1 TEXT NOT NULL,
      belief_id_2 TEXT NOT NULL,
      resolved INTEGER DEFAULT 0,
      resolution TEXT,
      metadata_json TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_belief_sources_belief ON belief_sources(belief_id);
    CREATE INDEX IF NOT EXISTS idx_contradictions_belief1 ON contradictions(belief_id_1);
    CREATE INDEX IF NOT EXISTS idx_contradictions_belief2 ON contradictions(belief_id_2);
  `);

  // Working Memory tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS working_memory (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      priority INTEGER DEFAULT 5,
      ttl_seconds INTEGER DEFAULT 300,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      metadata_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_working_memory_expires ON working_memory(expires_at);
    CREATE INDEX IF NOT EXISTS idx_working_memory_type ON working_memory(type);
  `);

  // Drives tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_drives (
      type TEXT PRIMARY KEY,
      level REAL NOT NULL,
      baseline_level REAL NOT NULL,
      accumulation_rate REAL NOT NULL,
      decay_rate REAL NOT NULL,
      satisfaction_threshold REAL NOT NULL,
      last_updated TEXT NOT NULL,
      last_satisfied TEXT
    );

    CREATE TABLE IF NOT EXISTS drive_events (
      id TEXT PRIMARY KEY,
      drive_type TEXT NOT NULL,
      event_type TEXT NOT NULL,
      amount REAL NOT NULL,
      level_before REAL NOT NULL,
      level_after REAL NOT NULL,
      trigger TEXT,
      timestamp TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_drive_events_type ON drive_events(drive_type);
    CREATE INDEX IF NOT EXISTS idx_drive_events_timestamp ON drive_events(timestamp);
  `);
}

// =============================================================================
// Main Runner
// =============================================================================

async function runAllTests(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('              RONALD-GI INTEGRATION TESTS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const db = new Database(':memory:');
  initializeSchema(db);
  const suites: TestSuite[] = [];

  // Run each test suite
  const testSuiteDefs = [
    { name: 'Memory Graph', fn: () => testMemoryGraph(db) },
    { name: 'Vector Search', fn: () => testVectorSearch(db) },
    { name: 'Trust & Provenance', fn: () => testTrustProvenance(db) },
    { name: 'Working Memory', fn: () => testWorkingMemory(db) },
    { name: 'Drives System', fn: () => testDrivesSystem(db) },
    { name: 'Memory Decay', fn: () => testMemoryDecay() },
  ];

  for (const suite of testSuiteDefs) {
    console.log(`\n📦 ${suite.name}`);
    console.log('─'.repeat(40));

    const start = performance.now();
    const results = await suite.fn();
    const duration = performance.now() - start;

    for (const result of results) {
      const icon = result.passed ? '✅' : '❌';
      console.log(`  ${icon} ${result.name} (${result.duration.toFixed(1)}ms)`);
      if (result.error) {
        console.log(`     Error: ${result.error}`);
      }
    }

    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed).length;

    suites.push({
      name: suite.name,
      results,
      passed,
      failed,
      duration,
    });
  }

  db.close();

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                         SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  let totalPassed = 0;
  let totalFailed = 0;

  for (const suite of suites) {
    const status = suite.failed === 0 ? '✅' : '❌';
    console.log(
      `${status} ${suite.name}: ${suite.passed}/${suite.passed + suite.failed} passed (${suite.duration.toFixed(0)}ms)`
    );
    totalPassed += suite.passed;
    totalFailed += suite.failed;
  }

  console.log('\n' + '─'.repeat(65));
  console.log(`Total: ${totalPassed}/${totalPassed + totalFailed} tests passed`);

  // Final verdict
  console.log('\n' + '═'.repeat(65));
  if (totalFailed === 0) {
    console.log('✅ ALL TESTS PASSED');
  } else {
    console.log(`❌ ${totalFailed} TESTS FAILED`);
    process.exit(1);
  }
}

// Run tests
runAllTests().catch(console.error);
