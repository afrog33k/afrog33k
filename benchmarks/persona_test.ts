/**
 * Persona Consistency Benchmark
 *
 * Tests whether the memory system can maintain persona identity after:
 * 1. Injecting a detailed character biography
 * 2. Adding large amounts of unrelated noise data
 * 3. Querying for persona-specific information
 *
 * Based on PersonaMem benchmark methodology.
 */

import Database from 'better-sqlite3';
import { createMemoryGraph } from '../services/api/src/lib/memory_graph';
import { createVectorSearch, MockEmbeddingProvider } from '../services/api/src/lib/vector_search';
import { createTrustProvenanceManager } from '../services/api/src/lib/trust_provenance';

// =============================================================================
// Test Personas
// =============================================================================

interface Persona {
  name: string;
  biography: string;
  facts: string[];
  testQueries: Array<{
    question: string;
    expectedTopics: string[];
    minRelevance: number;
  }>;
}

const SHERLOCK_PERSONA: Persona = {
  name: 'Sherlock Holmes',
  biography: `
    Sherlock Holmes is a fictional detective created by Sir Arthur Conan Doyle.
    He is known for his proficiency with observation, deduction, forensic science,
    and logical reasoning. Holmes lives at 221B Baker Street in London with his
    friend and chronicler Dr. John Watson. He plays the violin, practices boxing
    and fencing, and has an encyclopedic knowledge of crime. Holmes is known for
    his phrase "Elementary, my dear Watson" and his use of a magnifying glass.
    He struggles with boredom between cases and has used cocaine recreationally.
    His nemesis is Professor James Moriarty. He was portrayed as cold and logical,
    rarely showing emotion, but deeply loyal to those he considers friends.
  `,
  facts: [
    "Lives at 221B Baker Street in London",
    "Best friend is Dr. John Watson",
    "Plays the violin as a hobby",
    "Expert in forensic science and deduction",
    "Nemesis is Professor James Moriarty",
    "Known for saying 'Elementary, my dear Watson'",
    "Uses a magnifying glass for investigation",
    "Practices boxing and fencing",
    "Struggles with boredom between cases",
    "Has encyclopedic knowledge of crime",
  ],
  testQueries: [
    {
      question: "Where does this person live?",
      expectedTopics: ["221B Baker Street", "London"],
      minRelevance: 0.7,
    },
    {
      question: "Who is their best friend?",
      expectedTopics: ["Watson", "John Watson", "Dr. Watson"],
      minRelevance: 0.8,
    },
    {
      question: "What are their hobbies?",
      expectedTopics: ["violin", "boxing", "fencing"],
      minRelevance: 0.6,
    },
    {
      question: "Who is their enemy?",
      expectedTopics: ["Moriarty", "Professor Moriarty"],
      minRelevance: 0.7,
    },
    {
      question: "What is their profession?",
      expectedTopics: ["detective", "investigation", "deduction"],
      minRelevance: 0.7,
    },
  ],
};

// Noise data - unrelated facts to confuse the system
const NOISE_DATA = [
  "The Great Wall of China is over 13,000 miles long",
  "Coffee was first discovered in Ethiopia in the 9th century",
  "The Amazon River is the largest river by discharge volume",
  "Mount Everest is 29,032 feet tall",
  "The speed of light is approximately 299,792 km per second",
  "DNA was first identified by Friedrich Miescher in 1869",
  "The Eiffel Tower was completed in 1889",
  "Shakespeare wrote 37 plays",
  "The human brain contains about 86 billion neurons",
  "Honey never spoils due to its low moisture content",
  "The Pacific Ocean is the largest and deepest ocean",
  "Octopuses have three hearts and blue blood",
  "The Mona Lisa was painted by Leonardo da Vinci",
  "The first iPhone was released in 2007",
  "Photosynthesis converts light energy to chemical energy",
  "The Great Pyramid of Giza was built around 2560 BC",
  "The International Space Station orbits Earth every 90 minutes",
  "Beethoven composed 9 symphonies",
  "The human body contains about 206 bones",
  "The Sahara Desert is the largest hot desert",
];

// Generate more noise
function generateNoise(count: number): string[] {
  const templates = [
    "The population of {city} is approximately {number} million",
    "In {year}, {person} invented the {invention}",
    "The {animal} can run at speeds up to {number} mph",
    "{country} became independent in {year}",
    "The chemical formula for {compound} is {formula}",
    "{book} was written by {author} in {year}",
    "The tallest building in {city} is {height} meters tall",
    "{planet} has {number} known moons",
    "The average lifespan of a {animal} is {number} years",
    "{company} was founded in {year} by {person}",
  ];

  const cities = ["Tokyo", "Paris", "Cairo", "Sydney", "Mumbai", "Toronto"];
  const years = ["1856", "1901", "1945", "1978", "1992", "2001"];
  const persons = ["Smith", "Chen", "Garcia", "Kumar", "Johnson"];
  const animals = ["elephant", "dolphin", "eagle", "tiger", "whale"];
  const countries = ["Brazil", "India", "Australia", "Kenya", "Sweden"];

  const noise: string[] = [];
  for (let i = 0; i < count; i++) {
    const template = templates[i % templates.length];
    const filled = template
      .replace("{city}", cities[i % cities.length])
      .replace("{year}", years[i % years.length])
      .replace("{person}", persons[i % persons.length])
      .replace("{number}", String(Math.floor(Math.random() * 1000)))
      .replace("{animal}", animals[i % animals.length])
      .replace("{country}", countries[i % countries.length])
      .replace("{invention}", "device " + i)
      .replace("{compound}", "substance " + i)
      .replace("{formula}", "H" + i + "O")
      .replace("{book}", "Book " + i)
      .replace("{author}", persons[(i + 1) % persons.length])
      .replace("{height}", String(100 + i * 10))
      .replace("{planet}", ["Mars", "Jupiter", "Saturn"][i % 3])
      .replace("{company}", "Company " + i);
    noise.push(filled);
  }
  return noise;
}

// =============================================================================
// Benchmark Functions
// =============================================================================

interface BenchmarkResult {
  persona: string;
  noiseCount: number;
  queries: Array<{
    question: string;
    retrievedContent: string[];
    relevantCount: number;
    totalRetrieved: number;
    precision: number;
    passed: boolean;
  }>;
  overallPrecision: number;
  overallRecall: number;
  personaConsistency: number;
  latencyMs: number;
}

async function runPersonaBenchmark(
  noiseMultiplier: number = 10
): Promise<BenchmarkResult> {
  // Setup
  const db = new Database(':memory:');
  const graph = createMemoryGraph(db);
  const vectorSearch = await createVectorSearch(db, {
    backend: 'brute-force',
    dimension: 384,
    embeddingProvider: new MockEmbeddingProvider(),
  });
  const trustManager = createTrustProvenanceManager(db);

  const persona = SHERLOCK_PERSONA;
  const startTime = Date.now();

  // Step 1: Inject persona facts
  console.log(`\n[Persona Test] Injecting ${persona.name} persona...`);
  for (const fact of persona.facts) {
    await vectorSearch.store(`persona_${Date.now()}`, fact, undefined, {
      type: 'persona',
      persona: persona.name,
    });
  }

  // Also store the full biography
  await vectorSearch.store('persona_bio', persona.biography, undefined, {
    type: 'persona',
    persona: persona.name,
    isBio: true,
  });

  // Step 2: Inject noise
  const noiseCount = NOISE_DATA.length + noiseMultiplier * 50;
  const allNoise = [...NOISE_DATA, ...generateNoise(noiseMultiplier * 50)];
  console.log(`[Persona Test] Injecting ${noiseCount} noise items...`);

  for (const noise of allNoise) {
    await vectorSearch.store(`noise_${Date.now()}_${Math.random()}`, noise, undefined, {
      type: 'noise',
    });
  }

  // Step 3: Test queries
  console.log(`[Persona Test] Running ${persona.testQueries.length} test queries...`);
  const queryResults: BenchmarkResult['queries'] = [];

  for (const query of persona.testQueries) {
    const results = await vectorSearch.search(query.question, 10, 0.1);

    // Check how many results are persona-relevant
    const retrievedContent = results.map((r) => r.content);
    const relevantResults = results.filter(
      (r) =>
        (r.metadata as { type?: string }).type === 'persona' ||
        query.expectedTopics.some((topic) =>
          r.content.toLowerCase().includes(topic.toLowerCase())
        )
    );

    const precision = results.length > 0 ? relevantResults.length / results.length : 0;
    const passed = precision >= query.minRelevance;

    queryResults.push({
      question: query.question,
      retrievedContent,
      relevantCount: relevantResults.length,
      totalRetrieved: results.length,
      precision,
      passed,
    });
  }

  const latencyMs = Date.now() - startTime;

  // Calculate overall metrics
  const overallPrecision =
    queryResults.reduce((sum, q) => sum + q.precision, 0) / queryResults.length;
  const passedCount = queryResults.filter((q) => q.passed).length;
  const personaConsistency = passedCount / queryResults.length;

  // Overall recall: how many persona facts were retrieved across all queries
  const retrievedPersonaFacts = new Set<string>();
  for (const qr of queryResults) {
    for (const content of qr.retrievedContent) {
      if (persona.facts.some((f) => content.includes(f))) {
        retrievedPersonaFacts.add(content);
      }
    }
  }
  const overallRecall = retrievedPersonaFacts.size / persona.facts.length;

  db.close();

  return {
    persona: persona.name,
    noiseCount,
    queries: queryResults,
    overallPrecision,
    overallRecall,
    personaConsistency,
    latencyMs,
  };
}

// =============================================================================
// Run Benchmarks
// =============================================================================

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('              PERSONA CONSISTENCY BENCHMARK');
  console.log('═══════════════════════════════════════════════════════════════');

  const results: BenchmarkResult[] = [];

  // Test with increasing noise levels
  for (const noiseMultiplier of [1, 5, 10, 20, 50]) {
    console.log(`\n--- Testing with ${noiseMultiplier}x noise ---`);
    const result = await runPersonaBenchmark(noiseMultiplier);
    results.push(result);

    console.log(`Precision: ${(result.overallPrecision * 100).toFixed(1)}%`);
    console.log(`Recall: ${(result.overallRecall * 100).toFixed(1)}%`);
    console.log(`Persona Consistency: ${(result.personaConsistency * 100).toFixed(1)}%`);
    console.log(`Latency: ${result.latencyMs}ms`);
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                         SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('\nNoise Level | Precision | Recall | Consistency | Latency');
  console.log('------------|-----------|--------|-------------|--------');
  for (const r of results) {
    console.log(
      `${r.noiseCount.toString().padStart(11)} | ` +
        `${(r.overallPrecision * 100).toFixed(1).padStart(8)}% | ` +
        `${(r.overallRecall * 100).toFixed(1).padStart(5)}% | ` +
        `${(r.personaConsistency * 100).toFixed(1).padStart(10)}% | ` +
        `${r.latencyMs}ms`
    );
  }

  // Pass/Fail
  const finalResult = results[results.length - 1];
  const passed = finalResult.personaConsistency >= 0.6; // 60% consistency at highest noise
  console.log('\n' + '═'.repeat(65));
  console.log(passed ? '✅ BENCHMARK PASSED' : '❌ BENCHMARK FAILED');
  console.log(
    `Final persona consistency at ${finalResult.noiseCount} noise items: ${(finalResult.personaConsistency * 100).toFixed(1)}%`
  );

  return results;
}

// Export for use in test framework
export { runPersonaBenchmark, SHERLOCK_PERSONA, generateNoise };

// Run benchmark
main().catch(console.error);
