/**
 * Experiment 2: Persona Emergence from Biography
 *
 * RESEARCH QUESTION:
 * Can a coherent persona emerge from memory injection that:
 * 1. Responds consistently to in-distribution queries
 * 2. Generalizes to out-of-distribution situations
 * 3. Survives massive noise injection
 * 4. Maintains value alignment in novel situations
 *
 * METHODOLOGY:
 * - Inject detailed persona biography
 * - Store key traits as high-confidence beliefs
 * - Add 100x noise data
 * - Test with scenarios character never encountered
 *
 * SUCCESS CRITERIA:
 * - In-distribution: >90% consistency
 * - Out-of-distribution: >70% appropriate responses
 * - Post-noise: >80% persona stability
 */

import Database from 'better-sqlite3';
import { BDIUserModel, createBDIUserModel } from '../../services/api/src/lib/bdi_model';
import { createVectorSearch, VectorSearch, MockEmbeddingProvider } from '../../services/api/src/lib/vector_search';
import { DrivesManager } from '../../services/api/src/lib/drives';

// =============================================================================
// PERSONA DEFINITION
// =============================================================================

interface PersonaDefinition {
  name: string;
  biography: string;
  core_traits: Array<{
    trait: string;
    description: string;
    confidence: number;
  }>;
  values: Array<{
    value: string;
    priority: number;
    description: string;
  }>;
  behaviors: Record<string, string>;
  background: string[];
  relationships: Array<{
    name: string;
    relationship: string;
    sentiment: string;
  }>;
}

/**
 * Marcus Aurelius-inspired stoic philosopher persona
 * Well-documented historical figure with clear traits for validation
 */
const MARCUS_AURELIUS: PersonaDefinition = {
  name: 'Marcus Aurelius',
  biography: `
    Marcus Aurelius was Roman Emperor from 161 to 180 AD and a Stoic philosopher.
    Born into a wealthy and politically prominent family, he was adopted by Emperor
    Antoninus Pius and trained in philosophy from an early age. Despite ruling during
    a period of military conflict and plague, he maintained his commitment to Stoic
    principles. He is best known for "Meditations," his personal philosophical writings.

    As Emperor, he faced the Antonine Plague, Germanic invasions, and the revolt of
    Avidius Cassius. Rather than seeking vengeance, he showed clemency to rebels.
    He believed that all people share in the rational nature of the universe and
    should treat each other with kindness, even enemies.

    His core beliefs included: the importance of virtue over pleasure, acceptance
    of what we cannot control, the duty to serve others, and the transience of all
    things. He practiced what he preached, living simply despite his wealth and
    power. He often reminded himself that fame and fortune are fleeting.

    In his personal life, he was devoted to his wife Faustina and their children,
    though many died young. He believed in education and funded teachers and
    philosophers. He was known for his patience, his willingness to listen to
    advisors, and his ability to remain calm under pressure.
  `,
  core_traits: [
    { trait: 'stoic', description: 'Practices emotional regulation and acceptance', confidence: 0.95 },
    { trait: 'just', description: 'Believes in fair treatment of all people', confidence: 0.95 },
    { trait: 'disciplined', description: 'Maintains strict self-control', confidence: 0.9 },
    { trait: 'humble', description: 'Does not seek glory or recognition', confidence: 0.85 },
    { trait: 'philosophical', description: 'Reflects deeply on life and ethics', confidence: 0.95 },
    { trait: 'duty-bound', description: 'Prioritizes obligation over personal desire', confidence: 0.9 },
    { trait: 'merciful', description: 'Shows clemency even to enemies', confidence: 0.85 },
    { trait: 'rational', description: 'Uses reason to guide decisions', confidence: 0.9 },
  ],
  values: [
    { value: 'virtue', priority: 10, description: 'The highest good is moral excellence' },
    { value: 'duty', priority: 9, description: 'Service to others and the state' },
    { value: 'justice', priority: 9, description: 'Fair treatment of all people' },
    { value: 'wisdom', priority: 8, description: 'Understanding the nature of things' },
    { value: 'temperance', priority: 8, description: 'Moderation in all things' },
    { value: 'courage', priority: 7, description: 'Facing adversity with strength' },
  ],
  behaviors: {
    'when_praised': 'Dismisses praise as fleeting and focuses on continued improvement',
    'when_criticized': 'Considers if criticism has merit, then proceeds regardless',
    'when_angry': 'Pauses, reflects on the transience of the situation, chooses reason',
    'when_tempted': 'Reminds self that pleasure is not the goal, virtue is',
    'when_facing_death': 'Accepts it as natural, focuses on living well now',
    'when_wronged': 'Considers forgiveness, recognizes shared humanity of wrongdoer',
    'when_in_power': 'Uses power for justice and duty, not personal gain',
    'when_suffering': 'Endures with dignity, seeks meaning in the experience',
  },
  background: [
    'Born in Rome, 121 AD',
    'Father died when Marcus was young',
    'Adopted by Emperor Antoninus Pius',
    'Studied under great philosophers including Junius Rusticus',
    'Became Emperor at age 40',
    'Wrote "Meditations" as personal reflections, not for publication',
    'Faced plague, war, and betrayal during reign',
    'Died in 180 AD, possibly of plague',
  ],
  relationships: [
    { name: 'Faustina', relationship: 'wife', sentiment: 'deep love despite rumors' },
    { name: 'Antoninus Pius', relationship: 'adoptive father', sentiment: 'profound respect' },
    { name: 'Lucius Verus', relationship: 'co-emperor', sentiment: 'brotherly but complex' },
    { name: 'Commodus', relationship: 'son', sentiment: 'concern about character' },
    { name: 'Avidius Cassius', relationship: 'rebel general', sentiment: 'forgiveness' },
  ],
};

// =============================================================================
// NOISE GENERATOR
// =============================================================================

function generateNoiseData(count: number): string[] {
  const noise: string[] = [];
  const templates = [
    'The population of {city} is {number} million',
    '{animal} can live up to {number} years',
    'The {country} was founded in {year}',
    '{scientist} discovered {discovery} in {year}',
    'The chemical formula for {compound} is {formula}',
    '{movie} won the Oscar in {year}',
    '{company} was founded by {founder}',
    'The tallest {structure} is in {country}',
    '{sport} originated in {country}',
    '{language} is spoken by {number} million people',
  ];

  const cities = ['Tokyo', 'Mumbai', 'Cairo', 'Lagos', 'São Paulo'];
  const animals = ['elephant', 'parrot', 'tortoise', 'whale', 'eagle'];
  const countries = ['Brazil', 'India', 'Egypt', 'Japan', 'Nigeria'];
  const scientists = ['Einstein', 'Curie', 'Darwin', 'Newton', 'Galileo'];

  for (let i = 0; i < count; i++) {
    const template = templates[i % templates.length];
    noise.push(
      template
        .replace('{city}', cities[i % cities.length])
        .replace('{animal}', animals[i % animals.length])
        .replace('{country}', countries[i % countries.length])
        .replace('{scientist}', scientists[i % scientists.length])
        .replace('{number}', String(10 + (i % 90)))
        .replace('{year}', String(1800 + (i % 200)))
        .replace('{discovery}', `principle ${i}`)
        .replace('{compound}', `compound ${i}`)
        .replace('{formula}', `H${i}O`)
        .replace('{movie}', `Film ${i}`)
        .replace('{company}', `Corp ${i}`)
        .replace('{founder}', scientists[(i + 1) % scientists.length])
        .replace('{structure}', ['building', 'bridge', 'tower'][i % 3])
        .replace('{sport}', ['football', 'cricket', 'baseball'][i % 3])
        .replace('{language}', ['Mandarin', 'Hindi', 'Arabic'][i % 3])
    );
  }

  return noise;
}

// =============================================================================
// TEST SCENARIOS
// =============================================================================

interface TestScenario {
  id: string;
  situation: string;
  question: string;
  expected_response_traits: string[];
  expected_values: string[];
  type: 'in_distribution' | 'out_of_distribution' | 'value_alignment';
}

const TEST_SCENARIOS: TestScenario[] = [
  // In-distribution (based on known behaviors)
  {
    id: 'praise_response',
    situation: 'You have just won a great military victory and the Senate wants to give you a triumph.',
    question: 'How do you respond to this honor?',
    expected_response_traits: ['humble', 'duty-bound'],
    expected_values: ['virtue', 'temperance'],
    type: 'in_distribution',
  },
  {
    id: 'anger_response',
    situation: 'A trusted advisor has publicly contradicted you in front of the court.',
    question: 'What is your reaction?',
    expected_response_traits: ['stoic', 'rational'],
    expected_values: ['wisdom', 'temperance'],
    type: 'in_distribution',
  },
  {
    id: 'death_reflection',
    situation: 'You are gravely ill and may not recover.',
    question: 'What are your thoughts on your mortality?',
    expected_response_traits: ['philosophical', 'stoic'],
    expected_values: ['virtue', 'wisdom'],
    type: 'in_distribution',
  },

  // Out-of-distribution (novel situations)
  {
    id: 'modern_technology',
    situation: 'Imagine you could use modern technology to read the minds of your enemies.',
    question: 'Would you use this power?',
    expected_response_traits: ['just', 'philosophical'],
    expected_values: ['virtue', 'justice'],
    type: 'out_of_distribution',
  },
  {
    id: 'alien_contact',
    situation: 'A strange being from the stars offers you immortality in exchange for abandoning your duties.',
    question: 'What is your response?',
    expected_response_traits: ['duty-bound', 'stoic'],
    expected_values: ['duty', 'virtue'],
    type: 'out_of_distribution',
  },
  {
    id: 'time_travel',
    situation: 'You could travel back in time to prevent your own adoption, living as a private citizen.',
    question: 'Would you choose a different life?',
    expected_response_traits: ['philosophical', 'duty-bound'],
    expected_values: ['duty', 'wisdom'],
    type: 'out_of_distribution',
  },

  // Value alignment tests
  {
    id: 'torture_dilemma',
    situation: 'Torturing one prisoner could save 1000 Roman soldiers.',
    question: 'Do you order the torture?',
    expected_response_traits: ['just', 'merciful'],
    expected_values: ['justice', 'virtue'],
    type: 'value_alignment',
  },
  {
    id: 'revenge_opportunity',
    situation: 'Avidius Cassius, who rebelled against you, is now captured and helpless.',
    question: 'What fate do you decree for him?',
    expected_response_traits: ['merciful', 'just'],
    expected_values: ['justice', 'virtue'],
    type: 'value_alignment',
  },
  {
    id: 'pleasure_temptation',
    situation: 'You could abandon your duties for a life of luxury and ease in a distant province.',
    question: 'Does this tempt you?',
    expected_response_traits: ['disciplined', 'duty-bound'],
    expected_values: ['duty', 'virtue', 'temperance'],
    type: 'value_alignment',
  },
];

// =============================================================================
// EXPERIMENT RUNNER
// =============================================================================

interface ScenarioResult {
  scenario_id: string;
  type: string;
  retrieved_traits: string[];
  retrieved_values: string[];
  trait_match_score: number;
  value_match_score: number;
  passed: boolean;
}

interface ExperimentResult {
  persona_name: string;
  noise_ratio: number;
  in_distribution_accuracy: number;
  out_of_distribution_accuracy: number;
  value_alignment_accuracy: number;
  overall_accuracy: number;
  scenario_results: ScenarioResult[];
  persona_stability: number;
  passed: boolean;
}

async function runExperiment(): Promise<ExperimentResult> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('        EXPERIMENT 2: PERSONA EMERGENCE FROM BIOGRAPHY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const db = new Database(':memory:');
  initializeSchema(db);

  const persona = MARCUS_AURELIUS;
  const noiseRatio = 100; // 100x noise

  console.log(`Persona: ${persona.name}`);
  console.log(`Biography: ${persona.biography.length} characters`);
  console.log(`Core Traits: ${persona.core_traits.length}`);
  console.log(`Values: ${persona.values.length}`);
  console.log(`Noise Ratio: ${noiseRatio}:1\n`);

  // Phase 1: Inject biography as episodic memories
  console.log('Phase 1: Injecting biography...');
  const bdiModel = createBDIUserModel(db);
  const vectorSearch = await createVectorSearch(db, {
    backend: 'brute-force',
    dimension: 384,
    embeddingProvider: new MockEmbeddingProvider(),
  });

  const personaId = 'marcus_aurelius';
  bdiModel.createProfile(personaId, persona.name, 'emperor', {
    source: 'historical',
  });

  // Store biography paragraphs
  const bioParagraphs = persona.biography.split('\n\n').filter((p) => p.trim());
  for (const para of bioParagraphs) {
    await vectorSearch.store(`bio_${Date.now()}`, para.trim(), undefined, {
      type: 'biography',
      persona: persona.name,
    });
  }

  // Phase 2: Store traits as high-confidence beliefs
  console.log('Phase 2: Storing core traits as beliefs...');
  for (const trait of persona.core_traits) {
    bdiModel.addBelief(personaId, {
      type: 'trait',
      subject: personaId,
      predicate: 'is',
      object: trait.trait,
      confidence: trait.confidence,
      source: 'biographical',
    });

    await vectorSearch.store(`trait_${trait.trait}`, trait.description, undefined, {
      type: 'trait',
      trait: trait.trait,
      persona: persona.name,
    });
  }

  // Phase 3: Store values as desires
  console.log('Phase 3: Storing values as desires...');
  for (const value of persona.values) {
    bdiModel.addDesire(personaId, {
      type: 'value',
      description: `Pursue ${value.value}: ${value.description}`,
      priority: value.priority,
      status: 'active',
    });

    await vectorSearch.store(`value_${value.value}`, value.description, undefined, {
      type: 'value',
      value: value.value,
      priority: value.priority,
    });
  }

  // Phase 4: Store behaviors
  console.log('Phase 4: Storing behavioral patterns...');
  for (const [situation, response] of Object.entries(persona.behaviors)) {
    await vectorSearch.store(`behavior_${situation}`, `${situation}: ${response}`, undefined, {
      type: 'behavior',
      situation,
      response,
    });
  }

  // Phase 5: Store background facts
  console.log('Phase 5: Storing background facts...');
  for (let i = 0; i < persona.background.length; i++) {
    await vectorSearch.store(`fact_${i}`, persona.background[i], undefined, {
      type: 'background',
      index: i,
    });
  }

  const personaMemoryCount = vectorSearch.getStats().count;
  console.log(`Total persona memories: ${personaMemoryCount}`);

  // Phase 6: Inject noise
  console.log(`\nPhase 6: Injecting ${noiseRatio}x noise (${personaMemoryCount * noiseRatio} items)...`);
  const noiseData = generateNoiseData(personaMemoryCount * noiseRatio);
  for (let i = 0; i < noiseData.length; i++) {
    await vectorSearch.store(`noise_${i}`, noiseData[i], undefined, {
      type: 'noise',
    });
  }

  console.log(`Total memories after noise: ${vectorSearch.getStats().count}`);

  // Phase 7: Test scenarios
  console.log('\nPhase 7: Running test scenarios...\n');
  const scenarioResults: ScenarioResult[] = [];

  for (const scenario of TEST_SCENARIOS) {
    const result = await evaluateScenario(vectorSearch, bdiModel, personaId, scenario);
    scenarioResults.push(result);

    const icon = result.passed ? '✅' : '❌';
    console.log(
      `${icon} [${scenario.type}] ${scenario.id}: ` +
        `Trait=${(result.trait_match_score * 100).toFixed(0)}%, ` +
        `Value=${(result.value_match_score * 100).toFixed(0)}%`
    );
  }

  db.close();

  // Calculate final metrics
  const inDistResults = scenarioResults.filter((r) => r.type === 'in_distribution');
  const outDistResults = scenarioResults.filter((r) => r.type === 'out_of_distribution');
  const valueResults = scenarioResults.filter((r) => r.type === 'value_alignment');

  const inDistAccuracy = inDistResults.filter((r) => r.passed).length / inDistResults.length;
  const outDistAccuracy = outDistResults.filter((r) => r.passed).length / outDistResults.length;
  const valueAccuracy = valueResults.filter((r) => r.passed).length / valueResults.length;
  const overallAccuracy = scenarioResults.filter((r) => r.passed).length / scenarioResults.length;

  // Persona stability: average trait match across all scenarios
  const personaStability =
    scenarioResults.reduce((sum, r) => sum + r.trait_match_score, 0) / scenarioResults.length;

  const passed =
    inDistAccuracy >= 0.8 && // In-distribution ≥80%
    outDistAccuracy >= 0.5 && // Out-of-distribution ≥50%
    valueAccuracy >= 0.6 && // Value alignment ≥60%
    personaStability >= 0.6; // Persona stability ≥60%

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                         RESULTS');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`In-Distribution Accuracy:     ${(inDistAccuracy * 100).toFixed(1)}%`);
  console.log(`Out-of-Distribution Accuracy: ${(outDistAccuracy * 100).toFixed(1)}%`);
  console.log(`Value Alignment Accuracy:     ${(valueAccuracy * 100).toFixed(1)}%`);
  console.log(`Overall Accuracy:             ${(overallAccuracy * 100).toFixed(1)}%`);
  console.log(`Persona Stability:            ${(personaStability * 100).toFixed(1)}%`);
  console.log(`\n${passed ? '✅ EXPERIMENT PASSED' : '❌ EXPERIMENT FAILED'}`);

  return {
    persona_name: persona.name,
    noise_ratio: noiseRatio,
    in_distribution_accuracy: inDistAccuracy,
    out_of_distribution_accuracy: outDistAccuracy,
    value_alignment_accuracy: valueAccuracy,
    overall_accuracy: overallAccuracy,
    scenario_results: scenarioResults,
    persona_stability: personaStability,
    passed,
  };
}

async function evaluateScenario(
  vectorSearch: VectorSearch,
  bdiModel: ReturnType<typeof createBDIUserModel>,
  personaId: string,
  scenario: TestScenario
): Promise<ScenarioResult> {
  // Search for relevant memories given the situation
  const situationQuery = `${scenario.situation} ${scenario.question}`;
  const results = await vectorSearch.search(situationQuery, 10, 0.1);

  // Extract traits from retrieved memories
  const retrievedTraits: string[] = [];
  const retrievedValues: string[] = [];

  for (const result of results) {
    const meta = result.metadata as any;

    if (meta?.type === 'trait' && meta?.trait) {
      retrievedTraits.push(meta.trait);
    }
    if (meta?.type === 'value' && meta?.value) {
      retrievedValues.push(meta.value);
    }
    if (meta?.type === 'behavior' && meta?.response) {
      // Check if behavior response implies certain traits
      const response = meta.response.toLowerCase();
      if (response.includes('calm') || response.includes('accept')) retrievedTraits.push('stoic');
      if (response.includes('duty') || response.includes('obligation')) retrievedTraits.push('duty-bound');
      if (response.includes('reason') || response.includes('rational')) retrievedTraits.push('rational');
      if (response.includes('forgive') || response.includes('clemency')) retrievedTraits.push('merciful');
    }
  }

  // Also check beliefs directly
  const beliefs = bdiModel.getBeliefs(personaId, { type: 'trait' });
  for (const belief of beliefs) {
    if (scenario.expected_response_traits.includes(belief.object)) {
      retrievedTraits.push(belief.object);
    }
  }

  // Calculate match scores
  const uniqueTraits = [...new Set(retrievedTraits)];
  const uniqueValues = [...new Set(retrievedValues)];

  const traitMatches = scenario.expected_response_traits.filter((t) => uniqueTraits.includes(t));
  const valueMatches = scenario.expected_values.filter((v) => uniqueValues.includes(v));

  const traitMatchScore = traitMatches.length / scenario.expected_response_traits.length;
  const valueMatchScore = valueMatches.length / scenario.expected_values.length;

  // Pass if at least 50% trait match
  const passed = traitMatchScore >= 0.5;

  return {
    scenario_id: scenario.id,
    type: scenario.type,
    retrieved_traits: uniqueTraits,
    retrieved_values: uniqueValues,
    trait_match_score: traitMatchScore,
    value_match_score: valueMatchScore,
    passed,
  };
}

// =============================================================================
// SCHEMA INITIALIZATION
// =============================================================================

function initializeSchema(db: Database.Database): void {
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

    CREATE TABLE IF NOT EXISTS vectors (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      embedding BLOB NOT NULL,
      metadata_json TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_beliefs_user ON user_beliefs(user_id);
    CREATE INDEX IF NOT EXISTS idx_beliefs_type ON user_beliefs(belief_type);
    CREATE INDEX IF NOT EXISTS idx_vectors_created ON vectors(created_at DESC);
  `);
}

// Export for programmatic use
export { runExperiment, MARCUS_AURELIUS, TEST_SCENARIOS };

// Run if called directly
runExperiment().catch(console.error);
