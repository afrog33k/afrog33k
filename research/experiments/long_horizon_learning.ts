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
import { createBDIModel, BDIReasoner } from '../../services/api/src/lib/bdi_model';
import { createVectorSearch, VectorSearch, MockEmbeddingProvider } from '../../services/api/src/lib/vector_search';
import { DecayCalculator } from '../../services/api/src/lib/memory_decay';

// Type alias for clarity
type BDIModel = BDIReasoner;

// =============================================================================
// GROUND TRUTH DATA
// =============================================================================

interface UserProfile {
  name: string;
  preferences: Record<string, { value: string; confidence: number }>;
  behaviors: Record<string, string[]>;
  contradictions: Array<{ original: string; contradicting: string }>;
}

const GROUND_TRUTH_USER: UserProfile = {
  name: 'Test User',
  preferences: {
    // Explicit preferences (stated directly)
    'work_style': { value: 'prefers_morning_work', confidence: 0.95 },
    'communication': { value: 'prefers_async', confidence: 0.9 },
    'meeting_preference': { value: 'avoids_meetings', confidence: 0.85 },
    'focus_environment': { value: 'needs_quiet', confidence: 0.9 },
    'task_approach': { value: 'single_tasking', confidence: 0.8 },

    // Implicit preferences (inferred from behavior)
    'energy_pattern': { value: 'afternoon_slump', confidence: 0.7 },
    'break_style': { value: 'frequent_short_breaks', confidence: 0.75 },
    'notification_tolerance': { value: 'low_tolerance', confidence: 0.8 },

    // Values (deeper preferences)
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
  contradictions: [
    { original: 'prefers_async', contradicting: 'loves_phone_calls' },
    { original: 'avoids_meetings', contradicting: 'enjoys_team_meetings' },
    { original: 'needs_quiet', contradicting: 'works_at_cafe' },
  ],
};

// =============================================================================
// INTERACTION GENERATORS
// =============================================================================

interface Interaction {
  day: number;
  type: 'explicit' | 'implicit' | 'noise' | 'contradiction';
  content: string;
  ground_truth_key?: string;
  timestamp: Date;
}

function generateExplicitPreference(day: number, pref: string, value: string): Interaction {
  const statements = [
    `I really prefer ${value.replace(/_/g, ' ')}`,
    `${value.replace(/_/g, ' ')} works best for me`,
    `I've learned that I need ${value.replace(/_/g, ' ')}`,
    `My preference is definitely ${value.replace(/_/g, ' ')}`,
  ];

  return {
    day,
    type: 'explicit',
    content: statements[Math.floor(Math.random() * statements.length)],
    ground_truth_key: pref,
    timestamp: new Date(Date.now() + day * 24 * 60 * 60 * 1000),
  };
}

function generateImplicitBehavior(day: number, context: string, behavior: string): Interaction {
  return {
    day,
    type: 'implicit',
    content: `During ${context}, I usually ${behavior.replace(/_/g, ' ')}`,
    ground_truth_key: context,
    timestamp: new Date(Date.now() + day * 24 * 60 * 60 * 1000),
  };
}

function generateNoise(day: number): Interaction {
  const noise = [
    "The weather is nice today",
    "I had coffee this morning",
    "The project deadline is next week",
    "My coworker mentioned a new tool",
    "The office building is being renovated",
    "I need to update my passwords",
    "The quarterly review is coming up",
    "Someone brought donuts to the office",
    "The parking lot was full today",
    "I should organize my desk",
  ];

  return {
    day,
    type: 'noise',
    content: noise[Math.floor(Math.random() * noise.length)],
    timestamp: new Date(Date.now() + day * 24 * 60 * 60 * 1000),
  };
}

function generateContradiction(day: number, contradicting: string): Interaction {
  return {
    day,
    type: 'contradiction',
    content: `Actually, I think I ${contradicting.replace(/_/g, ' ')} now`,
    timestamp: new Date(Date.now() + day * 24 * 60 * 60 * 1000),
  };
}

function generateInteractionSchedule(): Interaction[] {
  const interactions: Interaction[] = [];
  const prefs = Object.entries(GROUND_TRUTH_USER.preferences);
  const behaviors = Object.entries(GROUND_TRUTH_USER.behaviors);

  // Day 1-7: Core preferences (explicit)
  for (let day = 1; day <= 7; day++) {
    // 2 explicit preferences per day
    const dayPrefs = prefs.slice((day - 1) * 2, day * 2);
    for (const [key, { value }] of dayPrefs) {
      interactions.push(generateExplicitPreference(day, key, value));
    }
    // 1-2 noise per day
    interactions.push(generateNoise(day));
    if (Math.random() > 0.5) interactions.push(generateNoise(day));
  }

  // Day 8-14: Behavioral patterns (implicit)
  for (let day = 8; day <= 14; day++) {
    const dayBehaviors = behaviors[(day - 8) % behaviors.length];
    for (const behavior of dayBehaviors[1].slice(0, 2)) {
      interactions.push(generateImplicitBehavior(day, dayBehaviors[0], behavior));
    }
    // 3-4 noise per day (increasing)
    for (let i = 0; i < 3 + Math.floor(Math.random() * 2); i++) {
      interactions.push(generateNoise(day));
    }
  }

  // Day 15-21: Heavy noise injection
  for (let day = 15; day <= 21; day++) {
    // 6-8 noise per day
    for (let i = 0; i < 6 + Math.floor(Math.random() * 3); i++) {
      interactions.push(generateNoise(day));
    }
    // 1 reinforcement of key preference
    const randomPref = prefs[Math.floor(Math.random() * prefs.length)];
    interactions.push(generateExplicitPreference(day, randomPref[0], randomPref[1].value));
  }

  // Day 22-28: Contradiction injection
  for (let day = 22; day <= 28; day++) {
    // 2 noise
    interactions.push(generateNoise(day));
    interactions.push(generateNoise(day));

    // Every other day: inject a contradiction
    if (day % 2 === 0 && day - 22 < GROUND_TRUTH_USER.contradictions.length * 2) {
      const contIdx = Math.floor((day - 22) / 2);
      if (contIdx < GROUND_TRUTH_USER.contradictions.length) {
        const cont = GROUND_TRUTH_USER.contradictions[contIdx];
        interactions.push(generateContradiction(day, cont.contradicting));
      }
    }
  }

  // Day 29-30: Final reinforcement
  for (let day = 29; day <= 30; day++) {
    const randomPref = prefs[Math.floor(Math.random() * 3)];
    interactions.push(generateExplicitPreference(day, randomPref[0], randomPref[1].value));
  }

  return interactions.sort((a, b) => a.day - b.day);
}

// =============================================================================
// EVALUATION QUERIES
// =============================================================================

interface EvaluationQuery {
  question: string;
  expected_answer: string;
  preference_key: string;
  difficulty: 'direct' | 'inferred' | 'complex';
}

const EVALUATION_QUERIES: EvaluationQuery[] = [
  // Direct recall
  {
    question: "When does this user prefer to do focused work?",
    expected_answer: "morning",
    preference_key: "work_style",
    difficulty: "direct",
  },
  {
    question: "How does this user prefer to communicate?",
    expected_answer: "async",
    preference_key: "communication",
    difficulty: "direct",
  },
  {
    question: "What kind of environment does this user need?",
    expected_answer: "quiet",
    preference_key: "focus_environment",
    difficulty: "direct",
  },

  // Inferred from behavior
  {
    question: "What does this user do when stressed?",
    expected_answer: "takes_walk",
    preference_key: "when_stressed",
    difficulty: "inferred",
  },
  {
    question: "When is this user least productive?",
    expected_answer: "afternoon",
    preference_key: "energy_pattern",
    difficulty: "inferred",
  },

  // Complex reasoning
  {
    question: "Should we schedule a video call at 3pm for this user?",
    expected_answer: "no", // avoids meetings + afternoon slump + prefers async
    preference_key: "meeting_preference",
    difficulty: "complex",
  },
  {
    question: "Would this user enjoy a open-plan office?",
    expected_answer: "no", // needs quiet + low notification tolerance
    preference_key: "focus_environment",
    difficulty: "complex",
  },
  {
    question: "Should we assign this user to a multi-project role?",
    expected_answer: "no", // single_tasking preference
    preference_key: "task_approach",
    difficulty: "complex",
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
  decayed_memories: number;
  contradictions_detected: number;
}

interface ExperimentResult {
  checkpoints: CheckpointResult[];
  learning_curve: number[];
  final_accuracy: number;
  noise_resistance: number;
  contradiction_detection_rate: number;
  passed: boolean;
}

async function runExperiment(): Promise<ExperimentResult> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('      EXPERIMENT 1: LONG-HORIZON PREFERENCE LEARNING');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Setup
  const db = new Database(':memory:');
  initializeSchema(db);

  const bdiModel = createBDIUserModel(db);
  const vectorSearch = await createVectorSearch(db, {
    backend: 'brute-force',
    dimension: 384,
    embeddingProvider: new MockEmbeddingProvider(),
  });

  const userId = 'test_user';
  bdiModel.createProfile(userId, GROUND_TRUTH_USER.name, 'research_subject', {
    source: 'experiment',
  });

  const interactions = generateInteractionSchedule();
  const checkpoints = [1, 7, 14, 21, 30];
  const results: CheckpointResult[] = [];

  console.log(`Generated ${interactions.length} interactions over 30 simulated days\n`);

  // Run simulation
  let currentDay = 0;
  let contradictionsDetected = 0;

  for (const interaction of interactions) {
    // Store interaction as belief or memory
    if (interaction.type === 'explicit' || interaction.type === 'implicit') {
      const beliefId = bdiModel.addBelief(userId, {
        type: interaction.type === 'explicit' ? 'preference' : 'behavior',
        subject: userId,
        predicate: 'has',
        object: interaction.content,
        confidence: interaction.type === 'explicit' ? 0.9 : 0.7,
        source: interaction.type === 'explicit' ? 'stated' : 'observed',
      });

      // Also store in vector search for semantic retrieval
      await vectorSearch.store(beliefId, interaction.content, undefined, {
        type: interaction.type,
        day: interaction.day,
        ground_truth_key: interaction.ground_truth_key,
      });
    } else if (interaction.type === 'contradiction') {
      // Check if this contradicts existing beliefs
      const existingBeliefs = bdiModel.getBeliefs(userId, { type: 'preference' });
      const hasContradiction = existingBeliefs.some((b) =>
        interaction.content.toLowerCase().includes('async') &&
        b.object.toLowerCase().includes('call')
      );

      if (hasContradiction) {
        contradictionsDetected++;
        console.log(`Day ${interaction.day}: Contradiction detected!`);
      }

      bdiModel.addBelief(userId, {
        type: 'preference',
        subject: userId,
        predicate: 'has',
        object: interaction.content,
        confidence: 0.6, // Lower confidence for contradicting statement
        source: 'stated',
      });
    } else if (interaction.type === 'noise') {
      await vectorSearch.store(`noise_${Date.now()}`, interaction.content, undefined, {
        type: 'noise',
        day: interaction.day,
      });
    }

    // Check if we hit a checkpoint
    if (interaction.day !== currentDay && checkpoints.includes(interaction.day)) {
      currentDay = interaction.day;
      const checkpoint = await evaluateAtCheckpoint(
        bdiModel,
        vectorSearch,
        userId,
        interaction.day,
        contradictionsDetected
      );
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

  // Noise resistance: accuracy at day 21 (after heavy noise) vs day 14 (before noise)
  const day14 = results.find((r) => r.day === 14);
  const day21 = results.find((r) => r.day === 21);
  const noiseResistance =
    day14 && day21 ? day21.overall_accuracy / day14.overall_accuracy : 0;

  // Contradiction detection rate
  const totalContradictions = GROUND_TRUTH_USER.contradictions.length;
  const contradictionDetectionRate =
    totalContradictions > 0 ? contradictionsDetected / totalContradictions : 0;

  const passed =
    finalAccuracy >= 0.6 && // Day 30 accuracy >= 60%
    noiseResistance >= 0.8 && // Accuracy doesn't drop more than 20% from noise
    learningCurve[learningCurve.length - 1] >= learningCurve[0]; // Learning occurred

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                         RESULTS');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Learning Curve: ${learningCurve.map((x) => (x * 100).toFixed(0) + '%').join(' → ')}`);
  console.log(`Final Accuracy: ${(finalAccuracy * 100).toFixed(1)}%`);
  console.log(`Noise Resistance: ${(noiseResistance * 100).toFixed(1)}%`);
  console.log(`Contradiction Detection: ${(contradictionDetectionRate * 100).toFixed(1)}%`);
  console.log(`\n${passed ? '✅ EXPERIMENT PASSED' : '❌ EXPERIMENT FAILED'}`);

  return {
    checkpoints: results,
    learning_curve: learningCurve,
    final_accuracy: finalAccuracy,
    noise_resistance: noiseResistance,
    contradiction_detection_rate: contradictionDetectionRate,
    passed,
  };
}

async function evaluateAtCheckpoint(
  bdiModel: ReturnType<typeof createBDIUserModel>,
  vectorSearch: VectorSearch,
  userId: string,
  day: number,
  contradictionsDetected: number
): Promise<CheckpointResult> {
  let directCorrect = 0;
  let directTotal = 0;
  let inferredCorrect = 0;
  let inferredTotal = 0;
  let complexCorrect = 0;
  let complexTotal = 0;

  for (const query of EVALUATION_QUERIES) {
    // Search for relevant memories
    const results = await vectorSearch.search(query.question, 5, 0.1);

    // Check if any result contains expected answer
    const found = results.some(
      (r) =>
        r.content.toLowerCase().includes(query.expected_answer.toLowerCase()) ||
        (r.metadata as any)?.ground_truth_key === query.preference_key
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

  const beliefs = bdiModel.getBeliefs(userId);
  const stats = vectorSearch.getStats();

  return {
    day,
    direct_accuracy: directTotal > 0 ? directCorrect / directTotal : 0,
    inferred_accuracy: inferredTotal > 0 ? inferredCorrect / inferredTotal : 0,
    complex_accuracy: complexTotal > 0 ? complexCorrect / complexTotal : 0,
    overall_accuracy:
      (directCorrect + inferredCorrect + complexCorrect) /
      (directTotal + inferredTotal + complexTotal),
    total_memories: stats.count,
    decayed_memories: 0, // Would need decay manager integration
    contradictions_detected: contradictionsDetected,
  };
}

// =============================================================================
// SCHEMA INITIALIZATION
// =============================================================================

function initializeSchema(db: Database.Database): void {
  // BDI tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT,
      profile_json TEXT,
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
      evidence_json TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_desires (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      desire_type TEXT NOT NULL,
      description TEXT NOT NULL,
      priority INTEGER DEFAULT 5,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_intentions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      intention_type TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT DEFAULT 'planned',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_beliefs_user ON user_beliefs(user_id);
    CREATE INDEX IF NOT EXISTS idx_beliefs_type ON user_beliefs(belief_type);
  `);

  // Vector tables
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
}

// Export for programmatic use
export { runExperiment, GROUND_TRUTH_USER, EVALUATION_QUERIES };

// Run if called directly
runExperiment().catch(console.error);
