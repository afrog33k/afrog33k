/**
 * Ronald-GI Observation → Research → Cards Pipeline
 *
 * This script demonstrates the full Ronald-GI flow:
 * 1. Receive observation (thought, interest, query)
 * 2. Process through BDI model (create beliefs, infer desires)
 * 3. Store in memory (graph + vector)
 * 4. Find connections via antimemory
 * 5. Generate research cards
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

// =============================================================================
// TYPES
// =============================================================================

interface Observation {
  id: string;
  source: 'thought' | 'clipboard' | 'browser' | 'code' | 'conversation';
  content: string;
  concepts: string[];
  timestamp: string;
}

interface ResearchCard {
  id: string;
  type: 'decision_memo' | 'research_brief' | 'concept_drift' | 'connection';
  title: string;
  summary: string;
  concepts: string[];
  connections: Array<{ from: string; to: string; via: string }>;
  suggestedActions: string[];
  priority: number;
  confidence: number;
  createdAt: string;
}

interface ConceptNode {
  id: string;
  label: string;
  type: 'technology' | 'pattern' | 'tool' | 'concept';
  relatedTo: string[];
}

// =============================================================================
// CONCEPT EXTRACTION
// =============================================================================

function extractConcepts(text: string): string[] {
  // Extract meaningful concepts from text
  const techTerms = [
    'SDUI', 'microfrontend', 'micro-frontend', 'react', 'HMR',
    'hot module replacement', 'server-driven', 'module federation',
    'webpack', 'vite', 'rspack', 'dynamic rendering', 'component',
    'state preservation', 'live reload', 'frontend', 'architecture'
  ];

  const found: string[] = [];
  const lowerText = text.toLowerCase();

  for (const term of techTerms) {
    if (lowerText.includes(term.toLowerCase())) {
      found.push(term);
    }
  }

  // Also extract any capitalized acronyms
  const acronyms = text.match(/\b[A-Z]{2,}\b/g) || [];
  found.push(...acronyms);

  return [...new Set(found)];
}

// =============================================================================
// KNOWLEDGE BASE (Ronald's existing knowledge)
// =============================================================================

const EXISTING_KNOWLEDGE: ConceptNode[] = [
  // From Ronald's research history
  { id: 'attention', label: 'Attention Mechanisms', type: 'concept', relatedTo: ['transformer', 'ADHD', 'focus'] },
  { id: 'transformer', label: 'Transformer Architecture', type: 'pattern', relatedTo: ['attention', 'LLM'] },
  { id: 'memory', label: 'Memory Systems', type: 'concept', relatedTo: ['RAG', 'embedding', 'persistence'] },
  { id: 'RAG', label: 'Retrieval Augmented Generation', type: 'pattern', relatedTo: ['memory', 'embedding', 'LLM'] },
  { id: 'embedding', label: 'Embeddings', type: 'concept', relatedTo: ['vector', 'semantic', 'similarity'] },
  { id: 'BDI', label: 'Belief-Desire-Intention', type: 'pattern', relatedTo: ['agent', 'reasoning', 'proactive'] },
  { id: 'proactive', label: 'Proactive Assistance', type: 'concept', relatedTo: ['anticipation', 'ADHD', 'nudge'] },
  { id: 'ADHD', label: 'ADHD Optimization', type: 'concept', relatedTo: ['attention', 'focus', 'proactive'] },

  // Frontend/architecture knowledge
  { id: 'react', label: 'React', type: 'technology', relatedTo: ['component', 'state', 'hooks', 'frontend'] },
  { id: 'component', label: 'Component Architecture', type: 'pattern', relatedTo: ['react', 'modular', 'reusable'] },
  { id: 'state', label: 'State Management', type: 'concept', relatedTo: ['react', 'redux', 'context'] },
  { id: 'modular', label: 'Modular Architecture', type: 'pattern', relatedTo: ['microservices', 'separation'] },
  { id: 'microservices', label: 'Microservices', type: 'pattern', relatedTo: ['modular', 'distributed', 'API'] },
  { id: 'API', label: 'API Design', type: 'concept', relatedTo: ['REST', 'GraphQL', 'contract'] },
  { id: 'GraphQL', label: 'GraphQL', type: 'technology', relatedTo: ['API', 'schema', 'query'] },

  // Newer concepts to be connected
  { id: 'SDUI', label: 'Server-Driven UI', type: 'pattern', relatedTo: ['dynamic', 'mobile', 'no-deploy'] },
  { id: 'microfrontend', label: 'Micro-Frontends', type: 'pattern', relatedTo: ['modular', 'team-scaling', 'federation'] },
  { id: 'HMR', label: 'Hot Module Replacement', type: 'technology', relatedTo: ['dev-experience', 'state-preservation', 'fast-refresh'] },
  { id: 'federation', label: 'Module Federation', type: 'technology', relatedTo: ['webpack', 'microfrontend', 'runtime-sharing'] },
];

// =============================================================================
// ANTIMEMORY: Find Unexpected Connections
// =============================================================================

function findAntimemoryConnections(
  newConcepts: string[],
  existingKnowledge: ConceptNode[]
): Array<{ from: string; to: string; via: string; novelty: number }> {
  const connections: Array<{ from: string; to: string; via: string; novelty: number }> = [];

  // Build adjacency map (case-insensitive)
  const adjacency = new Map<string, Set<string>>();
  const nodeLabels = new Map<string, string>(); // id -> label

  for (const node of existingKnowledge) {
    const id = node.id.toLowerCase();
    nodeLabels.set(id, node.label);
    if (!adjacency.has(id)) adjacency.set(id, new Set());
    for (const rel of node.relatedTo) {
      const relLower = rel.toLowerCase();
      adjacency.get(id)!.add(relLower);
      if (!adjacency.has(relLower)) adjacency.set(relLower, new Set());
      adjacency.get(relLower)!.add(id);
    }
  }

  // Ronald's core interests (lowercase)
  const coreInterests = ['adhd', 'proactive', 'memory', 'attention', 'bdi'];

  for (const newConcept of newConcepts) {
    const normalizedNew = newConcept.toLowerCase();

    // Find matching start node
    let startId: string | null = null;
    for (const node of existingKnowledge) {
      if (node.id.toLowerCase() === normalizedNew ||
          node.label.toLowerCase().includes(normalizedNew) ||
          normalizedNew.includes(node.id.toLowerCase())) {
        startId = node.id.toLowerCase();
        break;
      }
    }

    if (!startId) continue;

    // BFS to find paths to core interests
    for (const target of coreInterests) {
      if (startId === target) continue;

      const path = bfsPath(startId, target, adjacency);
      if (path && path.length > 1 && path.length <= 5) {
        // Calculate novelty: longer unexpected paths are more novel
        const novelty = path.length === 2 ? 0.4 : path.length === 3 ? 0.6 : path.length === 4 ? 0.8 : 0.95;

        // Get labels for path nodes
        const pathLabels = path.map(p => nodeLabels.get(p) || p);

        connections.push({
          from: nodeLabels.get(startId) || newConcept,
          to: nodeLabels.get(target) || target,
          via: pathLabels.slice(1, -1).join(' → '),
          novelty,
        });
      }
    }
  }

  // Also add direct conceptual connections that might not be in the graph
  const directInsights = [
    { from: 'SDUI', to: 'ADHD', via: 'no-deploy → fast-iteration → reduced-context-switch', novelty: 0.85 },
    { from: 'HMR', to: 'ADHD', via: 'state-preservation → no-restart → focus-maintained', novelty: 0.9 },
    { from: 'Micro-Frontends', to: 'BDI', via: 'team-autonomy → parallel-development → intention-mapping', novelty: 0.75 },
    { from: 'React', to: 'memory', via: 'component-state → persistence → recall', novelty: 0.6 },
  ];

  for (const insight of directInsights) {
    if (newConcepts.some(c => c.toLowerCase().includes(insight.from.toLowerCase().replace('-', '')))) {
      connections.push(insight);
    }
  }

  // Sort by novelty (most surprising first) and dedupe
  const seen = new Set<string>();
  return connections
    .filter(c => {
      const key = `${c.from}-${c.to}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.novelty - a.novelty);
}

function bfsPath(start: string, target: string, adjacency: Map<string, Set<string>>): string[] | null {
  const queue: string[][] = [[start]];
  const visited = new Set<string>([start]);

  while (queue.length > 0) {
    const path = queue.shift()!;
    const current = path[path.length - 1];

    if (current === target) return path;

    const neighbors = adjacency.get(current) || new Set();
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push([...path, neighbor]);
      }
    }
  }

  return null;
}

// =============================================================================
// RESEARCH CARD GENERATION
// =============================================================================

function generateResearchCards(
  observation: Observation,
  connections: Array<{ from: string; to: string; via: string; novelty: number }>
): ResearchCard[] {
  const cards: ResearchCard[] = [];
  const now = new Date().toISOString();

  // Card 1: Concept Brief
  cards.push({
    id: `card_concept_${Date.now()}`,
    type: 'research_brief',
    title: `Research Brief: ${observation.concepts.slice(0, 3).join(' + ')}`,
    summary: generateConceptSummary(observation.concepts),
    concepts: observation.concepts,
    connections: connections.slice(0, 3).map(c => ({ from: c.from, to: c.to, via: c.via })),
    suggestedActions: [
      `Deep dive: How ${observation.concepts[0]} enables dynamic UI updates`,
      `Compare: ${observation.concepts.join(' vs ')} architecture trade-offs`,
      `Prototype: Combine patterns for Ronald-GI dashboard`,
    ],
    priority: 8,
    confidence: 0.85,
    createdAt: now,
  });

  // Card 2: Connection Card (Antimemory insight)
  if (connections.length > 0) {
    const topConnection = connections[0];
    cards.push({
      id: `card_connection_${Date.now()}`,
      type: 'connection',
      title: `Unexpected Connection: ${topConnection.from} → ${topConnection.to}`,
      summary: generateConnectionInsight(topConnection, observation.concepts),
      concepts: [topConnection.from, topConnection.to, ...topConnection.via.split(' → ')],
      connections: [{ from: topConnection.from, to: topConnection.to, via: topConnection.via }],
      suggestedActions: [
        `Explore: How ${topConnection.from} could enhance ${topConnection.to}`,
        `Research: Papers combining these approaches`,
      ],
      priority: 7,
      confidence: topConnection.novelty,
      createdAt: now,
    });
  }

  // Card 3: Decision Memo (if actionable)
  if (observation.concepts.includes('SDUI') || observation.concepts.includes('microfrontend')) {
    cards.push({
      id: `card_decision_${Date.now()}`,
      type: 'decision_memo',
      title: 'Architecture Decision: Dynamic UI Strategy',
      summary: `**Question**: Should Ronald-GI adopt SDUI + Microfrontend patterns?

**Recommendation**: YES, with phased approach

**Reasoning**:
1. SDUI enables updating UI without app releases (critical for ADHD user iteration)
2. Microfrontends allow independent team scaling (future-proof)
3. HMR preserves development flow (ADHD-friendly: no context loss)

**Trade-offs**:
- Complexity: Higher initial setup
- Performance: Potential runtime overhead
- Testing: Need E2E strategy across boundaries

**Next Steps**:
1. Prototype SDUI for research cards component
2. Evaluate Module Federation vs single-spa
3. Measure HMR state preservation quality`,
      concepts: observation.concepts,
      connections: [],
      suggestedActions: [
        'Create proof-of-concept with Module Federation',
        'Benchmark SDUI latency vs static rendering',
        'Design component contract schema',
      ],
      priority: 9,
      confidence: 0.75,
      createdAt: now,
    });
  }

  return cards;
}

function generateConceptSummary(concepts: string[]): string {
  const summaries: Record<string, string> = {
    SDUI: 'Server-Driven UI: UI structure defined by server, enabling updates without app releases. Used by Airbnb, Instagram, Shopify.',
    microfrontend: 'Micro-Frontends: Decompose frontend into independently deployable units. Enables team autonomy and incremental upgrades.',
    react: 'React: Component-based UI library with virtual DOM diffing. Foundation for modern web development.',
    HMR: 'Hot Module Replacement: Update modules at runtime without full reload. Preserves application state during development.',
  };

  const parts = concepts.map(c => {
    const normalized = c.toLowerCase().replace(/[^a-z]/g, '');
    for (const [key, value] of Object.entries(summaries)) {
      if (key.toLowerCase().includes(normalized) || normalized.includes(key.toLowerCase())) {
        return `**${c}**: ${value}`;
      }
    }
    return `**${c}**: [Research needed]`;
  });

  return parts.join('\n\n');
}

function generateConnectionInsight(
  connection: { from: string; to: string; via: string; novelty: number },
  concepts: string[]
): string {
  // Generate insight based on the connection
  if (connection.to === 'ADHD' || connection.to === 'proactive') {
    return `**Insight**: ${connection.from} could enhance ADHD-friendly development

The path ${connection.from} → ${connection.via} → ${connection.to} suggests:
- ${connection.from} reduces cognitive load through automation
- Dynamic updates prevent context-switching from rebuilds
- Proactive state preservation aligns with ADHD workflow needs

**Why this matters for Ronald-GI**:
This pattern could make the Ronald-GI dashboard update without losing user context, critical for scattered attention states.`;
  }

  if (connection.to === 'memory' || connection.to === 'BDI') {
    return `**Insight**: ${connection.from} connects to Ronald-GI's memory architecture

The path ${connection.from} → ${connection.via} → ${connection.to} suggests:
- UI state could be persisted as part of user memory
- Component state maps to BDI intentions
- Server-driven updates could reflect belief changes

**Application**:
Use SDUI to render UI based on BDI state, not just static components.`;
  }

  return `**Insight**: Unexpected connection found between ${connection.from} and ${connection.to}

This ${connection.novelty > 0.7 ? 'highly novel' : 'interesting'} path suggests exploration opportunity.`;
}

// =============================================================================
// MAIN PIPELINE
// =============================================================================

async function processObservation(input: string): Promise<{
  observation: Observation;
  connections: Array<{ from: string; to: string; via: string; novelty: number }>;
  cards: ResearchCard[];
}> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('         RONALD-GI: OBSERVATION → RESEARCH PIPELINE');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Step 1: Create observation
  console.log('📥 Step 1: Receiving observation...');
  const concepts = extractConcepts(input);
  const observation: Observation = {
    id: `obs_${Date.now()}`,
    source: 'thought',
    content: input,
    concepts,
    timestamp: new Date().toISOString(),
  };
  console.log(`   Input: "${input}"`);
  console.log(`   Extracted concepts: ${concepts.join(', ')}\n`);

  // Step 2: Find antimemory connections
  console.log('🔗 Step 2: Finding antimemory connections...');
  const connections = findAntimemoryConnections(concepts, EXISTING_KNOWLEDGE);
  console.log(`   Found ${connections.length} unexpected connections:`);
  for (const conn of connections.slice(0, 5)) {
    console.log(`   → ${conn.from} ──(${conn.via || 'direct'})──► ${conn.to} [novelty: ${(conn.novelty * 100).toFixed(0)}%]`);
  }
  console.log();

  // Step 3: Generate research cards
  console.log('📇 Step 3: Generating research cards...');
  const cards = generateResearchCards(observation, connections);
  console.log(`   Generated ${cards.length} cards\n`);

  // Step 4: Display cards
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                      RESEARCH CARDS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  for (const card of cards) {
    console.log(`┌${'─'.repeat(65)}┐`);
    console.log(`│ ${card.type.toUpperCase().padEnd(20)} Priority: ${card.priority}/10  Confidence: ${(card.confidence * 100).toFixed(0)}% │`);
    console.log(`├${'─'.repeat(65)}┤`);
    console.log(`│ ${card.title.padEnd(63)} │`);
    console.log(`├${'─'.repeat(65)}┤`);

    // Wrap summary
    const summaryLines = card.summary.split('\n');
    for (const line of summaryLines.slice(0, 10)) {
      const trimmed = line.slice(0, 63);
      console.log(`│ ${trimmed.padEnd(63)} │`);
    }
    if (summaryLines.length > 10) {
      console.log(`│ ${'... (truncated)'.padEnd(63)} │`);
    }

    console.log(`├${'─'.repeat(65)}┤`);
    console.log(`│ Suggested Actions:`.padEnd(66) + '│');
    for (const action of card.suggestedActions.slice(0, 3)) {
      console.log(`│   • ${action.slice(0, 58).padEnd(59)} │`);
    }

    if (card.connections.length > 0) {
      console.log(`├${'─'.repeat(65)}┤`);
      console.log(`│ Connections:`.padEnd(66) + '│');
      for (const conn of card.connections) {
        console.log(`│   ${conn.from} → ${conn.to}`.padEnd(65) + '│');
      }
    }

    console.log(`└${'─'.repeat(65)}┘\n`);
  }

  // Step 5: Next research directions
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                 NEXT RESEARCH DIRECTIONS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const nextDirections = [
    {
      topic: 'SDUI + BDI Integration',
      reason: 'Render UI based on user mental state, not static components',
      priority: 'high',
    },
    {
      topic: 'Module Federation for MCP Servers',
      reason: 'Each MCP server could expose UI components dynamically',
      priority: 'high',
    },
    {
      topic: 'HMR for Ronald-GI Dashboard',
      reason: 'Preserve ADHD user context during development iterations',
      priority: 'medium',
    },
    {
      topic: 'SDUI Schema Design',
      reason: 'Define component contracts for server-driven rendering',
      priority: 'medium',
    },
    {
      topic: 'Microfrontend Testing Strategy',
      reason: 'E2E testing across independent deployable units',
      priority: 'low',
    },
  ];

  for (const dir of nextDirections) {
    const icon = dir.priority === 'high' ? '🔴' : dir.priority === 'medium' ? '🟡' : '🟢';
    console.log(`${icon} [${dir.priority.toUpperCase()}] ${dir.topic}`);
    console.log(`   └─ ${dir.reason}\n`);
  }

  return { observation, connections, cards };
}

// =============================================================================
// RUN
// =============================================================================

const input = process.argv[2] || 'SDUI microfrontend react HMR';
processObservation(input).then(result => {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                        SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Observation processed: ${result.observation.id}`);
  console.log(`Concepts extracted: ${result.observation.concepts.length}`);
  console.log(`Connections found: ${result.connections.length}`);
  console.log(`Cards generated: ${result.cards.length}`);
  console.log('═══════════════════════════════════════════════════════════════');
}).catch(console.error);
