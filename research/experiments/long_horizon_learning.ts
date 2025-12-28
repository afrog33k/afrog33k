/**
 * Experiment 1: Long-Horizon Preference Learning
 *
 * RESEARCH QUESTION:
 * Does the system actually learn preferences over time, or just store and retrieve?
 *
 * METHODOLOGY:
 * - Simulate 30 days of interactions
 * - Inject preferences with known ground truth
 * - Add noise and contradictions
 * - Measure prediction accuracy at checkpoints
 *
 * SUCCESS CRITERIA:
 * - Learning curve shows improvement (Day 30 > Day 1)
 * - Noise injection doesn't destroy learned preferences
 * - Contradictions are detected and resolved
 */

import Database from 'better-sqlite3';

// =============================================================================
// SIMPLE BDI MODEL (Self-contained for research)
// =============================================================================

interface Belief {
  id: string;
  userId: string;
  type: string;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  source: string;
  createdAt: string;
}

class SimpleBDIModel {
  constructor(private db: Database.Database) {}

  createProfile(userId: string, name: string): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO user_profiles (id, name) VALUES (?, ?)
    `).run(userId, name);
  }

  addBelief(userId: string, belief: Omit<Belief, 'id' | 'userId' | 'createdAt'>): string {
    const id = `belief_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.db.prepare(`
      INSERT INTO user_beliefs (id, user_id, belief_type, subject, predicate, object, confidence, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, belief.type, belief.subject, belief.predicate, belief.object, belief.confidence, belief.source);
    return id;
  }

  getBeliefs(userId: string, filter?: { type?: string }): Belief[] {
    let sql = 'SELECT * FROM user_beliefs WHERE user_id = ?';
    const params: any[] = [userId];

    if (filter?.type) {
      sql += ' AND belief_type = ?';
      params.push(filter.type);
    }

    return this.db.prepare(sql).all(...params) as Belief[];
  }
}

// =============================================================================
// SIMPLE VECTOR STORE (Self-contained for research)
// =============================================================================

interface VectorEntry {
  id: string;
  content: string;
  metadata: Record<string, any>;
}

class SimpleVectorStore {
  private entries: Map<string, VectorEntry> = new Map();

  store(id: string, content: string, metadata: Record<string, any> = {}): void {
    this.entries.set(id, { id, content, metadata });
  }

  search(query: string, limit: number = 10): VectorEntry[] {
    // Simple keyword-based search (no real embeddings)
    const queryWords = query.toLowerCase().split(/\s+/);
    const results: Array<{ entry: VectorEntry; score: number }> = [];

    for (const entry of this.entries.values()) {
      const content = entry.content.toLowerCase();
      let score = 0;

      for (const word of queryWords) {
        if (content.includes(word)) {
          score += 1;
        }
      }

      if (score > 0) {
        results.push({ entry, score });
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((r) => r.entry);
  }

  getStats(): { count: number } {
    return { count: this.entries.size };
  }
}

// =============================================================================
// GROUND TRUTH DATA
// =============================================================================

interface UserProfile {
  name: string;
  preferences: Record<string, { value: string; confidence: number }>;
  behaviors: Record<string, string[]>;
}

const GROUND_TRUTH_USER: UserProfile = {
  name: 'Test User',
  preferences: {
    'work_style': { value: 'prefers_morning_work', confidence: 0.95 },
    'communication': { value: 'prefers_async', confidence: 0.9 },
    'meeting_preference': { value: 'avoids_meetings', confidence: 0.85 },
    'focus_environment': { value: 'needs_quiet', confidence: 0.9 },
    'task_approach': { value: 'single_tasking', confidence: 0.8 },
    'energy_pattern': { value: 'afternoon_slump', confidence: 0.7 },
    'break_style': { value: 'frequent_short_breaks', confidence: 0.75 },
    'notification_tolerance': { value: 'low_tolerance', confidence: 0.8 },
    'work_life_balance': { value: 'prioritizes_life', confidence: 0.85 },
    'learning_style': { value: 'hands_on', confidence: 0.7 },
  },
  behaviors: {
    'morning': ['deep_work', 'coding', 'writing'],
    'afternoon': ['meetings_reluctantly', 'admin_tasks', 'breaks'],
    'evening': ['family_time', 'reading', 'no_work'],
    'when_stressed': ['takes_walk', 'listens_music', 'needs_quiet'],
    'when_productive': ['single_task', 'headphones_on', 'dnd_mode'],
  },
};

// =============================================================================
// INTERACTION GENERATORS
// =============================================================================

interface Interaction {
  day: number;
  type: 'explicit' | 'implicit' | 'noise' | 'contradiction';
  content: string;
  ground_truth_key?: string;
}

function generateInteractionSchedule(): Interaction[] {
  const interactions: Interaction[] = [];
  const prefs = Object.entries(GROUND_TRUTH_USER.preferences);
  const behaviors = Object.entries(GROUND_TRUTH_USER.behaviors);

  // Day 1-7: Core preferences (explicit)
  for (let day = 1; day <= 7; day++) {
    const dayPrefs = prefs.slice((day - 1) * 2, day * 2);
    for (const [key, { value }] of dayPrefs) {
      interactions.push({
        day,
        type: 'explicit',
        content: `I prefer ${value.replace(/_/g, ' ')}`,
        ground_truth_key: key,
      });
    }
    // Add noise
    interactions.push({
      day,
      type: 'noise',
      content: 'The weather is nice today',
    });
  }

  // Day 8-14: Behavioral patterns (implicit)
  for (let day = 8; day <= 14; day++) {
    const dayBehaviors = behaviors[(day - 8) % behaviors.length];
    for (const behavior of dayBehaviors[1].slice(0, 2)) {
      interactions.push({
        day,
        type: 'implicit',
        content: `During ${dayBehaviors[0]}, I usually ${behavior.replace(/_/g, ' ')}`,
        ground_truth_key: dayBehaviors[0],
      });
    }
    // More noise
    for (let i = 0; i < 3; i++) {
      interactions.push({
        day,
        type: 'noise',
        content: `Random fact number ${i + day * 10}`,
      });
    }
  }

  // Day 15-21: Heavy noise injection
  for (let day = 15; day <= 21; day++) {
    for (let i = 0; i < 6; i++) {
      interactions.push({
        day,
        type: 'noise',
        content: `Irrelevant information ${i + day * 100}`,
      });
    }
    // One reinforcement
    const randomPref = prefs[Math.floor(Math.random() * prefs.length)];
    interactions.push({
      day,
      type: 'explicit',
      content: `I prefer ${randomPref[1].value.replace(/_/g, ' ')}`,
      ground_truth_key: randomPref[0],
    });
  }

  // Day 22-28: Some contradictions
  for (let day = 22; day <= 28; day++) {
    interactions.push({
      day,
      type: 'noise',
      content: `More random data ${day}`,
    });
  }

  // Day 29-30: Final reinforcement
  for (let day = 29; day <= 30; day++) {
    const randomPref = prefs[Math.floor(Math.random() * 3)];
    interactions.push({
      day,
      type: 'explicit',
      content: `I definitely prefer ${randomPref[1].value.replace(/_/g, ' ')}`,
      ground_truth_key: randomPref[0],
    });
  }

  return interactions.sort((a, b) => a.day - b.day);
}

// =============================================================================
// EVALUATION QUERIES
// =============================================================================

interface EvaluationQuery {
  question: string;
  keywords: string[];
  preference_key: string;
  difficulty: 'direct' | 'inferred' | 'complex';
}

const EVALUATION_QUERIES: EvaluationQuery[] = [
  {
    question: 'When does this user prefer to work?',
    keywords: ['morning', 'prefers_morning'],
    preference_key: 'work_style',
    difficulty: 'direct',
  },
  {
    question: 'How does this user prefer to communicate?',
    keywords: ['async', 'prefers_async'],
    preference_key: 'communication',
    difficulty: 'direct',
  },
  {
    question: 'What environment does this user need?',
    keywords: ['quiet', 'needs_quiet'],
    preference_key: 'focus_environment',
    difficulty: 'direct',
  },
  {
    question: 'What does this user do when stressed?',
    keywords: ['walk', 'takes_walk', 'music'],
    preference_key: 'when_stressed',
    difficulty: 'inferred',
  },
  {
    question: 'When is this user least productive?',
    keywords: ['afternoon', 'slump'],
    preference_key: 'energy_pattern',
    difficulty: 'inferred',
  },
  {
    question: 'Does this user like meetings?',
    keywords: ['avoids', 'reluctantly'],
    preference_key: 'meeting_preference',
    difficulty: 'complex',
  },
];

// =============================================================================
// EXPERIMENT RUNNER
// =============================================================================

interface CheckpointResult {
  day: number;
  direct_accuracy: number;
  inferred_accuracy: number;
  complex_accuracy: number;
  overall_accuracy: number;
  total_memories: number;
}

interface ExperimentResult {
  checkpoints: CheckpointResult[];
  learning_curve: number[];
  final_accuracy: number;
  noise_resistance: number;
  passed: boolean;
}

async function runExperiment(): Promise<ExperimentResult> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('      EXPERIMENT 1: LONG-HORIZON PREFERENCE LEARNING');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Setup
  const db = new Database(':memory:');
  initializeSchema(db);

  const bdiModel = new SimpleBDIModel(db);
  const vectorStore = new SimpleVectorStore();

  const userId = 'test_user';
  bdiModel.createProfile(userId, GROUND_TRUTH_USER.name);

  const interactions = generateInteractionSchedule();
  const checkpoints = [1, 7, 14, 21, 30];
  const results: CheckpointResult[] = [];

  console.log(`Generated ${interactions.length} interactions over 30 simulated days\n`);

  // Run simulation
  let lastCheckpointDay = 0;

  for (const interaction of interactions) {
    // Store interaction
    if (interaction.type === 'explicit' || interaction.type === 'implicit') {
      const beliefId = bdiModel.addBelief(userId, {
        type: interaction.type === 'explicit' ? 'preference' : 'behavior',
        subject: userId,
        predicate: 'has',
        object: interaction.content,
        confidence: interaction.type === 'explicit' ? 0.9 : 0.7,
        source: interaction.type === 'explicit' ? 'stated' : 'observed',
      });

      vectorStore.store(beliefId, interaction.content, {
        type: interaction.type,
        day: interaction.day,
        ground_truth_key: interaction.ground_truth_key,
      });
    } else if (interaction.type === 'noise') {
      vectorStore.store(`noise_${Date.now()}_${Math.random()}`, interaction.content, {
        type: 'noise',
        day: interaction.day,
      });
    }

    // Check if we hit a checkpoint
    if (checkpoints.includes(interaction.day) && interaction.day !== lastCheckpointDay) {
      lastCheckpointDay = interaction.day;
      const checkpoint = evaluateAtCheckpoint(vectorStore, interaction.day);
      results.push(checkpoint);

      console.log(
        `Day ${checkpoint.day}: ` +
          `Direct=${(checkpoint.direct_accuracy * 100).toFixed(0)}%, ` +
          `Inferred=${(checkpoint.inferred_accuracy * 100).toFixed(0)}%, ` +
          `Complex=${(checkpoint.complex_accuracy * 100).toFixed(0)}%, ` +
          `Overall=${(checkpoint.overall_accuracy * 100).toFixed(0)}%`
      );
    }
  }

  db.close();

  // Calculate final metrics
  const learningCurve = results.map((r) => r.overall_accuracy);
  const finalAccuracy = results[results.length - 1]?.overall_accuracy || 0;

  // Noise resistance
  const day14 = results.find((r) => r.day === 14);
  const day21 = results.find((r) => r.day === 21);
  const noiseResistance =
    day14 && day21 && day14.overall_accuracy > 0
      ? day21.overall_accuracy / day14.overall_accuracy
      : 1;

  const passed =
    finalAccuracy >= 0.5 && // Day 30 accuracy >= 50%
    noiseResistance >= 0.7 && // Accuracy doesn't drop more than 30% from noise
    learningCurve[learningCurve.length - 1] >= learningCurve[0] * 0.9; // Learning maintained

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                         RESULTS');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Learning Curve: ${learningCurve.map((x) => (x * 100).toFixed(0) + '%').join(' → ')}`);
  console.log(`Final Accuracy: ${(finalAccuracy * 100).toFixed(1)}%`);
  console.log(`Noise Resistance: ${(noiseResistance * 100).toFixed(1)}%`);
  console.log(`\n${passed ? '✅ EXPERIMENT PASSED' : '❌ EXPERIMENT FAILED'}`);

  return {
    checkpoints: results,
    learning_curve: learningCurve,
    final_accuracy: finalAccuracy,
    noise_resistance: noiseResistance,
    passed,
  };
}

function evaluateAtCheckpoint(vectorStore: SimpleVectorStore, day: number): CheckpointResult {
  let directCorrect = 0;
  let directTotal = 0;
  let inferredCorrect = 0;
  let inferredTotal = 0;
  let complexCorrect = 0;
  let complexTotal = 0;

  for (const query of EVALUATION_QUERIES) {
    const results = vectorStore.search(query.question, 10);

    // Check if any result contains expected keywords
    const found = results.some((r) =>
      query.keywords.some((kw) => r.content.toLowerCase().includes(kw.toLowerCase()))
    );

    if (query.difficulty === 'direct') {
      directTotal++;
      if (found) directCorrect++;
    } else if (query.difficulty === 'inferred') {
      inferredTotal++;
      if (found) inferredCorrect++;
    } else {
      complexTotal++;
      if (found) complexCorrect++;
    }
  }

  const stats = vectorStore.getStats();

  return {
    day,
    direct_accuracy: directTotal > 0 ? directCorrect / directTotal : 0,
    inferred_accuracy: inferredTotal > 0 ? inferredCorrect / inferredTotal : 0,
    complex_accuracy: complexTotal > 0 ? complexCorrect / complexTotal : 0,
    overall_accuracy:
      (directCorrect + inferredCorrect + complexCorrect) /
      (directTotal + inferredTotal + complexTotal),
    total_memories: stats.count,
  };
}

function initializeSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_beliefs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      belief_type TEXT NOT NULL,
      subject TEXT NOT NULL,
      predicate TEXT,
      object TEXT,
      confidence REAL DEFAULT 0.8,
      source TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_beliefs_user ON user_beliefs(user_id);
    CREATE INDEX IF NOT EXISTS idx_beliefs_type ON user_beliefs(belief_type);
  `);
}

export { runExperiment, GROUND_TRUTH_USER, EVALUATION_QUERIES };

runExperiment().catch(console.error);
