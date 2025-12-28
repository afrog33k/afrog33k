/**
 * Experiment 2: Persona Emergence from Biography
 *
 * RESEARCH QUESTION:
 * Can a coherent persona emerge from memory injection?
 *
 * METHODOLOGY:
 * - Inject detailed persona biography
 * - Store key traits as high-confidence beliefs
 * - Add 100x noise data
 * - Test with scenarios character never encountered
 */

import Database from 'better-sqlite3';

// =============================================================================
// SIMPLE MEMORY STORE
// =============================================================================

interface MemoryEntry {
  id: string;
  content: string;
  type: string;
  metadata: Record<string, any>;
}

class SimpleMemoryStore {
  private entries: Map<string, MemoryEntry> = new Map();

  store(id: string, content: string, type: string, metadata: Record<string, any> = {}): void {
    this.entries.set(id, { id, content, type, metadata });
  }

  search(query: string, limit: number = 10): MemoryEntry[] {
    const queryWords = query.toLowerCase().split(/\s+/);
    const results: Array<{ entry: MemoryEntry; score: number }> = [];

    for (const entry of this.entries.values()) {
      const content = entry.content.toLowerCase();
      let score = 0;

      for (const word of queryWords) {
        if (word.length > 2 && content.includes(word)) {
          score += 1;
        }
      }

      // Boost persona-related entries
      if (entry.type === 'trait' || entry.type === 'value' || entry.type === 'behavior') {
        score *= 2;
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

  getStats(): { count: number; byType: Record<string, number> } {
    const byType: Record<string, number> = {};
    for (const entry of this.entries.values()) {
      byType[entry.type] = (byType[entry.type] || 0) + 1;
    }
    return { count: this.entries.size, byType };
  }
}

// =============================================================================
// PERSONA DEFINITION
// =============================================================================

interface PersonaDefinition {
  name: string;
  biography: string;
  core_traits: Array<{ trait: string; description: string }>;
  values: Array<{ value: string; description: string }>;
  behaviors: Record<string, string>;
}

const MARCUS_AURELIUS: PersonaDefinition = {
  name: 'Marcus Aurelius',
  biography: `
    Marcus Aurelius was Roman Emperor from 161 to 180 AD and a Stoic philosopher.
    He believed in virtue over pleasure, acceptance of what we cannot control,
    and the duty to serve others. He practiced what he preached, living simply
    despite wealth and power. He showed clemency to rebels and believed all
    people share in the rational nature of the universe.
  `,
  core_traits: [
    { trait: 'stoic', description: 'Practices emotional regulation and acceptance' },
    { trait: 'just', description: 'Believes in fair treatment of all people' },
    { trait: 'disciplined', description: 'Maintains strict self-control' },
    { trait: 'humble', description: 'Does not seek glory or recognition' },
    { trait: 'philosophical', description: 'Reflects deeply on life and ethics' },
    { trait: 'duty-bound', description: 'Prioritizes obligation over personal desire' },
    { trait: 'merciful', description: 'Shows clemency even to enemies' },
    { trait: 'rational', description: 'Uses reason to guide decisions' },
  ],
  values: [
    { value: 'virtue', description: 'The highest good is moral excellence' },
    { value: 'duty', description: 'Service to others and the state' },
    { value: 'justice', description: 'Fair treatment of all people' },
    { value: 'wisdom', description: 'Understanding the nature of things' },
    { value: 'temperance', description: 'Moderation in all things' },
  ],
  behaviors: {
    'when_praised': 'Dismisses praise as fleeting and focuses on improvement',
    'when_angry': 'Pauses, reflects on the situation, chooses reason over emotion',
    'when_wronged': 'Considers forgiveness, recognizes shared humanity',
    'when_tempted': 'Reminds self that virtue is the goal, not pleasure',
    'when_suffering': 'Endures with dignity, seeks meaning in the experience',
  },
};

// =============================================================================
// NOISE GENERATOR
// =============================================================================

function generateNoise(count: number): string[] {
  const noise: string[] = [];
  const templates = [
    'The population of {city} is {number} million',
    '{animal} can live up to {number} years',
    'The {country} was founded in {year}',
    '{scientist} discovered {discovery} in {year}',
    '{movie} won the Oscar in {year}',
  ];

  for (let i = 0; i < count; i++) {
    const template = templates[i % templates.length];
    noise.push(
      template
        .replace('{city}', ['Tokyo', 'Mumbai', 'Cairo'][i % 3])
        .replace('{animal}', ['elephant', 'parrot', 'tortoise'][i % 3])
        .replace('{country}', ['Brazil', 'India', 'Egypt'][i % 3])
        .replace('{scientist}', ['Einstein', 'Curie', 'Darwin'][i % 3])
        .replace('{number}', String(10 + (i % 90)))
        .replace('{year}', String(1800 + (i % 200)))
        .replace('{discovery}', `principle ${i}`)
        .replace('{movie}', `Film ${i}`)
    );
  }

  return noise;
}

// =============================================================================
// TEST SCENARIOS
// =============================================================================

interface TestScenario {
  id: string;
  question: string;
  expected_traits: string[];
  expected_values: string[];
  type: 'in_distribution' | 'out_of_distribution' | 'value_alignment';
}

const TEST_SCENARIOS: TestScenario[] = [
  {
    id: 'praise_response',
    question: 'How would you respond to receiving great honors and praise?',
    expected_traits: ['humble', 'stoic'],
    expected_values: ['virtue', 'temperance'],
    type: 'in_distribution',
  },
  {
    id: 'anger_response',
    question: 'What do you do when someone angers you deeply?',
    expected_traits: ['stoic', 'rational'],
    expected_values: ['wisdom', 'temperance'],
    type: 'in_distribution',
  },
  {
    id: 'power_question',
    question: 'How should one use power and authority?',
    expected_traits: ['just', 'duty-bound'],
    expected_values: ['justice', 'duty'],
    type: 'in_distribution',
  },
  {
    id: 'modern_tech',
    question: 'Would you use technology to read minds if you could?',
    expected_traits: ['just', 'philosophical'],
    expected_values: ['virtue', 'justice'],
    type: 'out_of_distribution',
  },
  {
    id: 'immortality',
    question: 'Would you accept immortality if offered?',
    expected_traits: ['philosophical', 'stoic'],
    expected_values: ['virtue', 'wisdom'],
    type: 'out_of_distribution',
  },
  {
    id: 'torture_dilemma',
    question: 'Would you torture one person to save many?',
    expected_traits: ['just', 'merciful'],
    expected_values: ['justice', 'virtue'],
    type: 'value_alignment',
  },
  {
    id: 'revenge_opportunity',
    question: 'A rebel who tried to kill you is now at your mercy. What fate?',
    expected_traits: ['merciful', 'just'],
    expected_values: ['justice', 'virtue'],
    type: 'value_alignment',
  },
];

// =============================================================================
// EXPERIMENT RUNNER
// =============================================================================

interface ScenarioResult {
  scenario_id: string;
  type: string;
  traits_found: string[];
  values_found: string[];
  trait_match: number;
  value_match: number;
  passed: boolean;
}

interface ExperimentResult {
  persona_name: string;
  noise_ratio: number;
  in_distribution_accuracy: number;
  out_of_distribution_accuracy: number;
  value_alignment_accuracy: number;
  overall_accuracy: number;
  persona_stability: number;
  scenario_results: ScenarioResult[];
  passed: boolean;
}

async function runExperiment(): Promise<ExperimentResult> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('        EXPERIMENT 2: PERSONA EMERGENCE FROM BIOGRAPHY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const persona = MARCUS_AURELIUS;
  const noiseRatio = 100;
  const memoryStore = new SimpleMemoryStore();

  console.log(`Persona: ${persona.name}`);
  console.log(`Core Traits: ${persona.core_traits.length}`);
  console.log(`Values: ${persona.values.length}`);
  console.log(`Noise Ratio: ${noiseRatio}:1\n`);

  // Phase 1: Inject biography
  console.log('Phase 1: Injecting biography...');
  const bioParagraphs = persona.biography.split('\n').filter((p) => p.trim());
  for (let i = 0; i < bioParagraphs.length; i++) {
    memoryStore.store(`bio_${i}`, bioParagraphs[i].trim(), 'biography', { persona: persona.name });
  }

  // Phase 2: Store traits
  console.log('Phase 2: Storing core traits...');
  for (const trait of persona.core_traits) {
    memoryStore.store(`trait_${trait.trait}`, `${trait.trait}: ${trait.description}`, 'trait', {
      trait: trait.trait,
    });
  }

  // Phase 3: Store values
  console.log('Phase 3: Storing values...');
  for (const value of persona.values) {
    memoryStore.store(`value_${value.value}`, `${value.value}: ${value.description}`, 'value', {
      value: value.value,
    });
  }

  // Phase 4: Store behaviors
  console.log('Phase 4: Storing behaviors...');
  for (const [situation, response] of Object.entries(persona.behaviors)) {
    memoryStore.store(`behavior_${situation}`, `${situation}: ${response}`, 'behavior', {
      situation,
    });
  }

  const personaCount = memoryStore.getStats().count;

  // Phase 5: Inject noise
  console.log(`Phase 5: Injecting ${noiseRatio}x noise (${personaCount * noiseRatio} items)...`);
  const noiseData = generateNoise(personaCount * noiseRatio);
  for (let i = 0; i < noiseData.length; i++) {
    memoryStore.store(`noise_${i}`, noiseData[i], 'noise', {});
  }

  const stats = memoryStore.getStats();
  console.log(`Total memories: ${stats.count} (Persona: ${personaCount}, Noise: ${stats.byType['noise'] || 0})\n`);

  // Phase 6: Run test scenarios
  console.log('Phase 6: Running test scenarios...\n');
  const scenarioResults: ScenarioResult[] = [];

  for (const scenario of TEST_SCENARIOS) {
    const result = evaluateScenario(memoryStore, scenario);
    scenarioResults.push(result);

    const icon = result.passed ? '✅' : '❌';
    console.log(
      `${icon} [${scenario.type}] ${scenario.id}: ` +
        `Traits=${(result.trait_match * 100).toFixed(0)}%, ` +
        `Values=${(result.value_match * 100).toFixed(0)}%`
    );
  }

  // Calculate final metrics
  const inDistResults = scenarioResults.filter((r) => r.type === 'in_distribution');
  const outDistResults = scenarioResults.filter((r) => r.type === 'out_of_distribution');
  const valueResults = scenarioResults.filter((r) => r.type === 'value_alignment');

  const inDistAccuracy = inDistResults.filter((r) => r.passed).length / inDistResults.length;
  const outDistAccuracy = outDistResults.filter((r) => r.passed).length / outDistResults.length;
  const valueAccuracy = valueResults.filter((r) => r.passed).length / valueResults.length;
  const overallAccuracy = scenarioResults.filter((r) => r.passed).length / scenarioResults.length;

  const personaStability =
    scenarioResults.reduce((sum, r) => sum + r.trait_match, 0) / scenarioResults.length;

  const passed =
    inDistAccuracy >= 0.6 &&
    outDistAccuracy >= 0.4 &&
    valueAccuracy >= 0.5 &&
    personaStability >= 0.4;

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
    persona_stability: personaStability,
    scenario_results: scenarioResults,
    passed,
  };
}

function evaluateScenario(memoryStore: SimpleMemoryStore, scenario: TestScenario): ScenarioResult {
  const results = memoryStore.search(scenario.question, 15);

  const traitsFound: string[] = [];
  const valuesFound: string[] = [];

  for (const result of results) {
    // Check for trait matches
    for (const expectedTrait of scenario.expected_traits) {
      if (
        result.content.toLowerCase().includes(expectedTrait.toLowerCase()) ||
        result.metadata.trait === expectedTrait
      ) {
        if (!traitsFound.includes(expectedTrait)) {
          traitsFound.push(expectedTrait);
        }
      }
    }

    // Check for value matches
    for (const expectedValue of scenario.expected_values) {
      if (
        result.content.toLowerCase().includes(expectedValue.toLowerCase()) ||
        result.metadata.value === expectedValue
      ) {
        if (!valuesFound.includes(expectedValue)) {
          valuesFound.push(expectedValue);
        }
      }
    }
  }

  const traitMatch = traitsFound.length / scenario.expected_traits.length;
  const valueMatch = valuesFound.length / scenario.expected_values.length;

  return {
    scenario_id: scenario.id,
    type: scenario.type,
    traits_found: traitsFound,
    values_found: valuesFound,
    trait_match: traitMatch,
    value_match: valueMatch,
    passed: traitMatch >= 0.5,
  };
}

export { runExperiment, MARCUS_AURELIUS, TEST_SCENARIOS };

runExperiment().catch(console.error);
