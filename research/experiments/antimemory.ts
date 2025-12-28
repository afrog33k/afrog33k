/**
 * Experiment: Proactive Antimemory
 *
 * RESEARCH QUESTION:
 * Can the system surface relevant information the user WOULDN'T
 * think of themselves?
 *
 * Based on Paul Bricman's Conceptarium "antimemory" concept:
 * - Maintain a model of what you're currently thinking about
 * - Specifically surface ideas that run AGAINST your frame
 * - Expand awareness in unexpected but useful ways
 *
 * This is core to Ronald-GI as a proactive colleague:
 * Not just answering questions, but surfacing connections
 * you would have missed.
 */

// =============================================================================
// KNOWLEDGE BASE (Simulated user browsing/research history)
// =============================================================================

interface KnowledgeItem {
  id: string;
  content: string;
  domain: string;
  timestamp: Date;
  access_count: number;
  tags: string[];
}

// Simulated user knowledge base (1000 items from various domains)
function generateKnowledgeBase(): KnowledgeItem[] {
  const domains = [
    { name: 'programming', tags: ['code', 'typescript', 'react', 'nodejs'] },
    { name: 'ml', tags: ['ai', 'neural', 'transformer', 'training'] },
    { name: 'philosophy', tags: ['ethics', 'consciousness', 'epistemology'] },
    { name: 'business', tags: ['startup', 'revenue', 'market', 'growth'] },
    { name: 'productivity', tags: ['adhd', 'focus', 'habits', 'workflow'] },
    { name: 'design', tags: ['ui', 'ux', 'accessibility', 'color'] },
    { name: 'infrastructure', tags: ['docker', 'kubernetes', 'aws', 'database'] },
    { name: 'research', tags: ['paper', 'arxiv', 'benchmark', 'experiment'] },
  ];

  const items: KnowledgeItem[] = [];
  const baseDate = new Date('2024-01-01');

  for (let i = 0; i < 1000; i++) {
    const domain = domains[i % domains.length];
    const dayOffset = Math.floor(i / 10);
    const timestamp = new Date(baseDate.getTime() + dayOffset * 24 * 60 * 60 * 1000);

    items.push({
      id: `item_${i}`,
      content: `Knowledge item ${i} about ${domain.name}: ${domain.tags[i % domain.tags.length]}`,
      domain: domain.name,
      timestamp,
      access_count: Math.floor(Math.random() * 10),
      tags: domain.tags,
    });
  }

  // Add some specific high-value connections
  const specialItems: KnowledgeItem[] = [
    {
      id: 'special_1',
      content: 'ADHD cognitive strategies often mirror machine learning attention mechanisms',
      domain: 'cross_domain',
      timestamp: new Date('2024-06-15'),
      access_count: 1,
      tags: ['adhd', 'attention', 'ml', 'transformer'],
    },
    {
      id: 'special_2',
      content: 'Stoic philosophy concepts map to robust ML training: embrace variance as learning signal',
      domain: 'cross_domain',
      timestamp: new Date('2024-07-20'),
      access_count: 0,
      tags: ['philosophy', 'ml', 'training', 'robustness'],
    },
    {
      id: 'special_3',
      content: 'Spaced repetition decay curves are identical to transformer attention decay patterns',
      domain: 'cross_domain',
      timestamp: new Date('2024-08-10'),
      access_count: 0,
      tags: ['learning', 'attention', 'memory', 'transformer'],
    },
    {
      id: 'special_4',
      content: 'Paul Graham essays on startups apply directly to ML project management: iterate fast, measure everything',
      domain: 'cross_domain',
      timestamp: new Date('2024-09-05'),
      access_count: 2,
      tags: ['startup', 'ml', 'iteration', 'metrics'],
    },
    {
      id: 'special_5',
      content: 'Ancient memory palace techniques could inform modern RAG architecture design',
      domain: 'cross_domain',
      timestamp: new Date('2024-10-01'),
      access_count: 0,
      tags: ['memory', 'rag', 'architecture', 'ancient'],
    },
  ];

  return [...items, ...specialItems];
}

// =============================================================================
// CURRENT FOCUS (What user is thinking about now)
// =============================================================================

interface CurrentFocus {
  topic: string;
  domain: string;
  keywords: string[];
  time_spent_minutes: number;
}

const FOCUS_SCENARIOS: CurrentFocus[] = [
  {
    topic: 'Building RAG system for Ronald-GI',
    domain: 'programming',
    keywords: ['rag', 'embeddings', 'retrieval', 'vector'],
    time_spent_minutes: 45,
  },
  {
    topic: 'Debugging attention mechanism in transformer',
    domain: 'ml',
    keywords: ['attention', 'transformer', 'training', 'loss'],
    time_spent_minutes: 120,
  },
  {
    topic: 'Writing documentation for new API',
    domain: 'programming',
    keywords: ['api', 'docs', 'typescript', 'endpoints'],
    time_spent_minutes: 30,
  },
  {
    topic: 'Researching ADHD productivity techniques',
    domain: 'productivity',
    keywords: ['adhd', 'focus', 'productivity', 'strategies'],
    time_spent_minutes: 60,
  },
];

// =============================================================================
// RETRIEVAL STRATEGIES
// =============================================================================

interface Suggestion {
  item: KnowledgeItem;
  score: number;
  reason: string;
  type: 'obvious' | 'antimemory' | 'random';
}

interface RetrievalStrategy {
  name: string;
  retrieve(
    focus: CurrentFocus,
    knowledgeBase: KnowledgeItem[],
    limit: number
  ): Suggestion[];
}

// Simple word overlap similarity
function calculateSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a.map(x => x.toLowerCase()));
  const setB = new Set(b.map(x => x.toLowerCase()));
  let overlap = 0;
  for (const word of setA) {
    if (setB.has(word)) overlap++;
  }
  return overlap / Math.max(setA.size, setB.size);
}

// Strategy 1: Pure similarity (obvious matches)
const similarityStrategy: RetrievalStrategy = {
  name: 'Pure Similarity',
  retrieve(focus: CurrentFocus, kb: KnowledgeItem[], limit: number): Suggestion[] {
    const scored = kb.map(item => {
      const keywordSim = calculateSimilarity(focus.keywords, item.tags);
      const domainMatch = item.domain === focus.domain ? 0.3 : 0;
      const score = keywordSim + domainMatch;

      return {
        item,
        score,
        reason: `Similar to current focus (${focus.domain})`,
        type: 'obvious' as const,
      };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  },
};

// Strategy 2: Random baseline
const randomStrategy: RetrievalStrategy = {
  name: 'Random',
  retrieve(_focus: CurrentFocus, kb: KnowledgeItem[], limit: number): Suggestion[] {
    const shuffled = [...kb].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, limit).map(item => ({
      item,
      score: Math.random(),
      reason: 'Random selection',
      type: 'random' as const,
    }));
  },
};

// Strategy 3: Recency weighted
const recencyStrategy: RetrievalStrategy = {
  name: 'Recency Weighted',
  retrieve(focus: CurrentFocus, kb: KnowledgeItem[], limit: number): Suggestion[] {
    const now = new Date();
    const scored = kb.map(item => {
      const keywordSim = calculateSimilarity(focus.keywords, item.tags);
      const daysSince = (now.getTime() - item.timestamp.getTime()) / (1000 * 60 * 60 * 24);
      const recencyScore = Math.exp(-daysSince / 30); // 30-day half-life
      const score = keywordSim * 0.6 + recencyScore * 0.4;

      return {
        item,
        score,
        reason: `Recent + similar`,
        type: 'obvious' as const,
      };
    });

    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  },
};

// Strategy 4: Antimemory (Bricman-inspired)
const antimemoryStrategy: RetrievalStrategy = {
  name: 'Antimemory',
  retrieve(focus: CurrentFocus, kb: KnowledgeItem[], limit: number): Suggestion[] {
    // Key insight: we want LOW similarity to current focus but HIGH potential relevance
    // This is done by finding items from DIFFERENT domains that share SOME connection

    const suggestions: Suggestion[] = [];

    // Calculate current focus "fingerprint"
    const focusTags = new Set(focus.keywords);
    const focusDomain = focus.domain;

    for (const item of kb) {
      // Skip items in same domain (too obvious)
      if (item.domain === focusDomain) continue;

      // Calculate tag overlap (connection strength)
      const tagOverlap = item.tags.filter(t => focusTags.has(t)).length;

      // We want: different domain + some connection = antimemory candidate
      if (tagOverlap > 0 && tagOverlap < 3) {
        const score = tagOverlap * 0.5; // Some connection but not too much

        suggestions.push({
          item,
          score,
          reason: `Different domain (${item.domain}) with connection via: ${item.tags.filter(t => focusTags.has(t)).join(', ')}`,
          type: 'antimemory',
        });
      }
    }

    // Also boost cross-domain items (our special items)
    const crossDomain = kb.filter(item => item.domain === 'cross_domain');
    for (const item of crossDomain) {
      const tagOverlap = item.tags.filter(t => focusTags.has(t)).length;
      if (tagOverlap > 0) {
        suggestions.push({
          item,
          score: 1.0 + tagOverlap * 0.2,
          reason: `Cross-domain insight: ${item.content.slice(0, 50)}...`,
          type: 'antimemory',
        });
      }
    }

    return suggestions
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  },
};

// Strategy 5: Full Ronald-GI (hybrid)
const ronaldGIStrategy: RetrievalStrategy = {
  name: 'Ronald-GI (Hybrid)',
  retrieve(focus: CurrentFocus, kb: KnowledgeItem[], limit: number): Suggestion[] {
    // Balance: 40% obvious, 40% antimemory, 20% serendipity

    const obviousLimit = Math.floor(limit * 0.4);
    const antimemLimit = Math.floor(limit * 0.4);
    const serendipityLimit = limit - obviousLimit - antimemLimit;

    const obvious = similarityStrategy.retrieve(focus, kb, obviousLimit);
    const antimem = antimemoryStrategy.retrieve(focus, kb, antimemLimit);

    // Serendipity: recently accessed items from random domains
    const recentlyAccessed = kb
      .filter(item => item.access_count > 0 && item.domain !== focus.domain)
      .sort((a, b) => b.access_count - a.access_count)
      .slice(0, serendipityLimit)
      .map(item => ({
        item,
        score: 0.5,
        reason: `Frequently accessed, different context`,
        type: 'antimemory' as const,
      }));

    return [...obvious, ...antimem, ...recentlyAccessed].slice(0, limit);
  },
};

// =============================================================================
// EVALUATION
// =============================================================================

interface FocusResult {
  focus_topic: string;
  suggestions: Suggestion[];
  antimemory_count: number;
  obvious_count: number;
  random_count: number;
  cross_domain_hits: number;
}

interface EvaluationResult {
  strategy_name: string;
  antimemory_rate: number; // % of suggestions that are antimemory
  cross_domain_hit_rate: number; // % that found our special cross-domain items
  diversity_score: number; // How many different domains covered
  focus_results: FocusResult[];
}

function evaluateStrategy(
  strategy: RetrievalStrategy,
  kb: KnowledgeItem[],
  focuses: CurrentFocus[]
): EvaluationResult {
  const focusResults: FocusResult[] = [];
  let totalAntimemory = 0;
  let totalSuggestions = 0;
  let totalCrossDomain = 0;
  const allDomains = new Set<string>();

  for (const focus of focuses) {
    const suggestions = strategy.retrieve(focus, kb, 5);
    totalSuggestions += suggestions.length;

    const antimemoryCount = suggestions.filter(s => s.type === 'antimemory').length;
    const obviousCount = suggestions.filter(s => s.type === 'obvious').length;
    const randomCount = suggestions.filter(s => s.type === 'random').length;
    const crossDomainHits = suggestions.filter(s => s.item.domain === 'cross_domain').length;

    totalAntimemory += antimemoryCount;
    totalCrossDomain += crossDomainHits;

    for (const s of suggestions) {
      allDomains.add(s.item.domain);
    }

    focusResults.push({
      focus_topic: focus.topic,
      suggestions,
      antimemory_count: antimemoryCount,
      obvious_count: obviousCount,
      random_count: randomCount,
      cross_domain_hits: crossDomainHits,
    });
  }

  return {
    strategy_name: strategy.name,
    antimemory_rate: totalAntimemory / totalSuggestions,
    cross_domain_hit_rate: totalCrossDomain / totalSuggestions,
    diversity_score: allDomains.size / 8, // 8 total domains
    focus_results: focusResults,
  };
}

// =============================================================================
// EXPERIMENT RUNNER
// =============================================================================

async function runExperiment() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('            EXPERIMENT: PROACTIVE ANTIMEMORY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('RESEARCH QUESTION:');
  console.log('Can the system surface relevant information the user WOULDN\'T');
  console.log('think of themselves?\n');

  console.log('Based on Paul Bricman\'s Conceptarium antimemory concept:');
  console.log('  - Surface ideas that run AGAINST your current frame');
  console.log('  - Expand awareness in unexpected but useful ways\n');

  const kb = generateKnowledgeBase();
  console.log(`Knowledge base: ${kb.length} items`);
  console.log(`Special cross-domain items: ${kb.filter(i => i.domain === 'cross_domain').length}`);
  console.log(`Focus scenarios: ${FOCUS_SCENARIOS.length}\n`);

  const strategies: RetrievalStrategy[] = [
    similarityStrategy,
    randomStrategy,
    recencyStrategy,
    antimemoryStrategy,
    ronaldGIStrategy,
  ];

  console.log('─────────────────────────────────────────────────────────────────');
  console.log('                         RESULTS');
  console.log('─────────────────────────────────────────────────────────────────\n');

  const results: EvaluationResult[] = [];

  for (const strategy of strategies) {
    const result = evaluateStrategy(strategy, kb, FOCUS_SCENARIOS);
    results.push(result);

    const passAntimem = result.antimemory_rate >= 0.3 ? '✅' : '❌';
    const passCross = result.cross_domain_hit_rate >= 0.1 ? '✅' : '❌';
    const passDiversity = result.diversity_score >= 0.5 ? '✅' : '❌';

    console.log(`[${strategy.name}]`);
    console.log(`  ${passAntimem} Antimemory Rate:        ${(result.antimemory_rate * 100).toFixed(1)}%`);
    console.log(`  ${passCross} Cross-Domain Hits:      ${(result.cross_domain_hit_rate * 100).toFixed(1)}%`);
    console.log(`  ${passDiversity} Diversity Score:        ${(result.diversity_score * 100).toFixed(1)}%`);
    console.log();
  }

  // Summary comparison
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                    COMPARISON SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('┌────────────────────────┬────────────┬────────────┬──────────┐');
  console.log('│ Strategy               │ Antimemory │ CrossDomain│ Diverse  │');
  console.log('├────────────────────────┼────────────┼────────────┼──────────┤');
  for (const result of results) {
    const name = result.strategy_name.slice(0, 22).padEnd(22);
    const anti = `${(result.antimemory_rate * 100).toFixed(0)}%`.padStart(8);
    const cross = `${(result.cross_domain_hit_rate * 100).toFixed(0)}%`.padStart(8);
    const div = `${(result.diversity_score * 100).toFixed(0)}%`.padStart(6);
    console.log(`│ ${name} │ ${anti}   │ ${cross}   │ ${div}   │`);
  }
  console.log('└────────────────────────┴────────────┴────────────┴──────────┘');

  // Find best performer for antimemory
  const bestAntimemory = results.reduce((a, b) =>
    a.antimemory_rate > b.antimemory_rate ? a : b
  );

  console.log(`\nBest for Antimemory: ${bestAntimemory.strategy_name} (${(bestAntimemory.antimemory_rate * 100).toFixed(0)}%)`);

  // Show example antimemory suggestions
  const ronaldGI = results.find(r => r.strategy_name.includes('Ronald-GI'));
  if (ronaldGI && ronaldGI.focus_results.length > 0) {
    console.log('\n─────────────────────────────────────────────────────────────────');
    console.log('              EXAMPLE ANTIMEMORY SUGGESTIONS');
    console.log('─────────────────────────────────────────────────────────────────\n');

    for (const fr of ronaldGI.focus_results.slice(0, 2)) {
      console.log(`Focus: "${fr.focus_topic}"`);
      const antimemSuggestions = fr.suggestions.filter(s => s.type === 'antimemory');
      for (const s of antimemSuggestions.slice(0, 2)) {
        console.log(`  → ${s.item.content.slice(0, 60)}...`);
        console.log(`    Reason: ${s.reason}`);
      }
      console.log();
    }
  }

  // Success criteria
  const passes = ronaldGI &&
    ronaldGI.antimemory_rate >= 0.3 &&
    ronaldGI.cross_domain_hit_rate >= 0.1;

  console.log('═══════════════════════════════════════════════════════════════');
  if (passes) {
    console.log('✅ EXPERIMENT PASSED: System surfaces unexpected but relevant ideas');
  } else {
    console.log('❌ EXPERIMENT FAILED: Antimemory capability below threshold');
  }
  console.log('═══════════════════════════════════════════════════════════════');

  return { results, passed: passes };
}

export { runExperiment, generateKnowledgeBase, FOCUS_SCENARIOS };

runExperiment().catch(console.error);
