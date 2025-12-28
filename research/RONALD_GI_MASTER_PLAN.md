# Ronald-GI: Master Plan & Task List

**Created**: 2025-12-28
**Purpose**: Definitive reference so we never have to repeat this conversation

---

## Part 1: The Vision

### What Ronald-GI IS

Ronald-GI is a **LIVING ORGANISM**, not a toolkit of disconnected tools.

It is a system that:
- Receives your **stream of consciousness** (thoughts, bookmarks, history, code)
- **Continuously processes** and integrates into a coherent world model
- **Autonomously researches** based on value/cost of rabbit holes
- **Actually does the work** (web search, repo analysis, paper reading)
- **Detects inconsistencies** and asks 2-5 smart questions to resolve
- **Learns your research patterns** and gets better at anticipating
- **Returns meaningful cards** after doing real work, not fake outputs

### What Ronald-GI is NOT

- A collection of scripts that generate formatted text
- A chatbot that answers questions
- A set of tools you invoke manually
- A static system that waits for commands

### The Gestalt

Imagine having a brilliant research colleague who:
- Knows everything you've ever researched
- Notices when you're thinking about something
- Goes off and researches it without being asked
- Comes back with real insights, not summaries
- Asks smart questions when confused
- Learns how YOU like to research
- Never forgets, always connects

**That's Ronald-GI.**

---

## Part 2: Architecture Reference (AGI Memory)

AGI Memory by Eric Hartford is the closest existing implementation. Key lessons:

### The Brain is the Database

```
PostgreSQL = The Brain
├── memories (vectors for similarity search)
├── memory_graph (Apache AGE for relationships)
├── worldview_primitives (beliefs with confidence)
├── identity_aspects (who the agent is)
├── goals (what it's pursuing)
├── drives (internal motivations)
├── emotional_state (current affect)
└── heartbeat_state (continuous identity)
```

Everything flows through the database. The database IS the mind.

### Two Workers, Two Purposes

```
Heartbeat Worker (Conscious)          Maintenance Worker (Subconscious)
├── Wakes up periodically             ├── Runs on its own schedule
├── Reviews goals & state             ├── Consolidates memories
├── Decides what to do                ├── Prunes expired content
├── Executes actions                  ├── Applies decay
├── Updates state                     ├── Rebuilds indexes
└── Logs everything                   └── Manages housekeeping
```

### The Heartbeat Loop

```python
while alive:
    # 1. Gather context
    context = gather_turn_context()  # identity, worldview, emotions, drives, goals

    # 2. Build decision prompt
    prompt = build_decision_prompt(context, energy, action_costs)

    # 3. LLM decides what to do
    decision = llm.decide(prompt)  # returns actions, goal_changes, reasoning

    # 4. Execute actions
    for action in decision.actions:
        execute(action)  # recall, reflect, inquire, brainstorm, reach_out, rest

    # 5. Update state
    complete_heartbeat(decision)

    # 6. Sleep until next heartbeat
    await sleep(heartbeat_interval)
```

### hydrate() - Context Enrichment

Every interaction is enriched with:
- **Memories** - Vector similarity search for relevant content
- **Partial activations** - "Tip of tongue" cluster matches
- **Identity** - Who the agent is
- **Worldview** - Beliefs with confidence scores
- **Emotional state** - Current valence/arousal
- **Urgent drives** - What's demanding attention

### Key Insight: Actions Are Real

When AGI Memory's heartbeat decides to "inquire", it:
1. Queues an external_call with the question
2. Worker picks it up and calls the LLM
3. Result is stored as semantic memory
4. World model is updated

**It actually does the work, not just generates text about doing it.**

---

## Part 3: What Exists Now in Ronald-GI

### Disconnected Modules (services/api/src/lib/)

| Module | Lines | Purpose | Status |
|--------|-------|---------|--------|
| `bdi_model.ts` | 786 | Beliefs, Desires, Intentions | Implemented, untested in loop |
| `memory_layer.ts` | 732 | Graph, Vector, KV stores | Implemented, not unified |
| `memory_graph.ts` | ~400 | Graph relationships | Exists |
| `memory_decay.ts` | ~200 | Time-based forgetting | Exists |
| `anticipation_engine.ts` | 683 | Proactive needs detection | Implemented, not running |
| `attention_inference.ts` | ~300 | ADHD state detection | Implemented, not running |
| `self_evolution.ts` | 1038 | Learning from experience | Implemented, not running |
| `drives.ts` | 479 | Motivation system | Implemented, not running |
| `personalization.ts` | ~400 | User preferences | Exists |
| `vector_search.ts` | ~200 | Similarity search | Exists |
| `embedding_client.ts` | ~150 | Vector generation | Exists |

### Research Experiments (research/experiments/)

| Experiment | Result | What It Proves |
|------------|--------|----------------|
| Long-horizon learning | 50% | Preference learning works |
| Persona emergence | 50% (with embeddings) | Identity survives noise |
| World model coherence | 100% | Multi-hop reasoning works |
| High-bandwidth comm | 81% | One-word intent recognition |
| "My Way" learning | 83% (+186%) | Style learning works |
| Antimemory | 56% | Unexpected connections surface |

### The Problem

These modules exist but **don't form a living system**:
- No heartbeat loop running them
- No observation stream feeding them
- No actual research happening
- No coherent world model being built
- Each module tested in isolation, never unified

---

## Part 4: What Must Be Built

### 4.1 The Living Core

A single, continuously-running process that IS Ronald-GI.

```typescript
// core/living_core.ts
export class LivingCore {
  private db: Database;
  private worldModel: WorldModel;
  private researchEngine: ResearchEngine;
  private observationQueue: ObservationQueue;

  // The heartbeat - runs forever
  async run(): Promise<never> {
    while (true) {
      // 1. Process observation queue
      const observations = await this.observationQueue.drain();

      for (const obs of observations) {
        // 2. Integrate into world model
        const conflicts = await this.worldModel.integrate(obs);

        // 3. If conflicts, queue questions
        if (conflicts.length > 0) {
          await this.queueClarificationQuestions(conflicts);
        }

        // 4. Evaluate rabbit holes
        const rabbitHoles = await this.evaluateRabbitHoles(obs);

        // 5. Research high-value holes
        for (const hole of rabbitHoles.filter(h => h.value / h.cost > this.threshold)) {
          await this.researchEngine.research(hole);
        }
      }

      // 6. Generate cards if meaningful
      const cards = await this.generateCards();
      if (cards.length > 0) {
        await this.surfaceCards(cards);
      }

      // 7. Run maintenance
      await this.maintenance();

      // 8. Sleep until next heartbeat
      await this.sleep(this.heartbeatInterval);
    }
  }
}
```

### 4.2 Observation Stream

Sources that feed into the Living Core:

```typescript
// core/observation_stream.ts
interface Observation {
  id: string;
  source: ObservationSource;
  content: string;
  timestamp: Date;
  metadata: Record<string, unknown>;
}

type ObservationSource =
  | 'thought'      // Direct text input
  | 'clipboard'    // Clipboard watcher
  | 'browser'      // Browser history/tabs
  | 'bookmark'     // Saved bookmarks
  | 'code'         // File changes
  | 'conversation' // Chat messages
  | 'paper'        // Ingested papers
  | 'repo'         // Analyzed repositories
  ;

// Adapters for each source
interface ObservationAdapter {
  source: ObservationSource;
  watch(): AsyncIterator<Observation>;
}
```

### 4.3 World Model

Coherent storage of everything the system knows:

```typescript
// core/world_model.ts
interface WorldModel {
  // Concepts and relationships
  concepts: ConceptGraph;

  // Beliefs with confidence and evidence
  beliefs: BeliefStore;

  // Learned patterns
  patterns: PatternStore;

  // User model (BDI)
  user: BDIModel;

  // Research history
  researchLog: ResearchLog;

  // Methods
  integrate(obs: Observation): Promise<Conflict[]>;
  query(q: string): Promise<QueryResult>;
  findContradictions(): Promise<Contradiction[]>;
  getRelevantContext(focus: string): Promise<Context>;
}
```

### 4.4 Research Engine

Actually does the work:

```typescript
// core/research_engine.ts
interface ResearchEngine {
  // Evaluate if a topic is worth researching
  evaluateRabbitHole(topic: string): Promise<RabbitHoleEval>;

  // Actually do research
  research(hole: RabbitHole): Promise<ResearchResult>;

  // Specific research actions
  webSearch(query: string): Promise<SearchResult[]>;
  analyzeRepo(url: string): Promise<RepoAnalysis>;
  readPaper(url: string): Promise<PaperSummary>;
  evaluateCode(code: string): Promise<CodeEval>;

  // Synthesize findings
  synthesize(results: ResearchResult[]): Promise<Synthesis>;
}

interface RabbitHoleEval {
  topic: string;
  estimatedValue: number;    // How useful would this be?
  estimatedCost: number;     // How much effort?
  confidence: number;        // How sure are we?
  reasoning: string;         // Why this evaluation?
  suggestedDepth: 'skim' | 'read' | 'deep-dive';
}
```

### 4.5 Coherence Checker

Detects inconsistencies and asks smart questions:

```typescript
// core/coherence_checker.ts
interface CoherenceChecker {
  // Check if observation conflicts with existing beliefs
  checkConflicts(obs: Observation): Promise<Conflict[]>;

  // Generate clarifying questions (2-5, smart, targeted)
  generateQuestions(conflicts: Conflict[]): Promise<Question[]>;

  // Apply resolution
  resolveConflict(conflict: Conflict, resolution: Resolution): Promise<void>;
}

interface Question {
  id: string;
  conflict: Conflict;
  question: string;
  options: string[];  // Suggested answers
  importance: 'critical' | 'important' | 'nice-to-know';
}
```

### 4.6 Card Generator

Produces meaningful output after real work:

```typescript
// core/card_generator.ts
interface CardGenerator {
  // Only generate when there's something meaningful
  shouldGenerate(): Promise<boolean>;

  // Generate cards from research results
  generate(): Promise<Card[]>;
}

interface Card {
  id: string;
  type: CardType;
  title: string;
  content: string;
  concepts: string[];
  connections: Connection[];
  suggestedActions: string[];
  confidence: number;
  evidence: Evidence[];  // What research backs this up?
  createdAt: Date;
}

type CardType =
  | 'research_brief'    // Summary of research done
  | 'decision_memo'     // Recommendation with trade-offs
  | 'connection'        // Unexpected insight discovered
  | 'question'          // Clarification needed
  | 'pattern'           // Recurring theme noticed
  ;
```

### 4.7 Research Habit Learning

Learns the user's patterns:

```typescript
// core/habit_learner.ts
interface HabitLearner {
  // What rabbit holes do they find valuable?
  valueThreshold: number;

  // How deep do they typically go?
  depthPreference: 'skim' | 'read' | 'deep-dive';

  // What sources do they trust?
  sourceTrust: Map<string, number>;

  // When do they want interruption vs async?
  interruptionPreference: InterruptionProfile;

  // What synthesis format do they prefer?
  outputFormat: OutputFormat;

  // Learn from feedback
  learn(feedback: Feedback): Promise<void>;
}
```

---

## Part 5: Master Task List

### Phase 1: Foundation (The Living Core)

#### 1.1 Database Schema
- [ ] **T1.1.1** Design unified SQLite schema (inspired by AGI Memory's Postgres)
  - Tables: observations, concepts, beliefs, memories, research_log, cards, questions
  - Relationships via graph structure
  - Vector storage for similarity search
  - Confidence/trust scores on everything

- [ ] **T1.1.2** Implement schema migrations
  - From current scattered tables to unified model
  - Preserve existing experiment data

- [ ] **T1.1.3** Create database access layer
  - Single connection pool
  - Transaction support
  - Audit logging

#### 1.2 World Model
- [ ] **T1.2.1** Implement ConceptGraph
  - Concepts with relationships
  - Path finding between concepts
  - Antimemory connections

- [ ] **T1.2.2** Implement BeliefStore
  - Beliefs with confidence scores
  - Evidence tracking
  - Contradiction detection

- [ ] **T1.2.3** Implement PatternStore
  - Learned patterns from experience
  - Pattern matching for new observations

- [ ] **T1.2.4** Wire BDI model into world model
  - Use existing bdi_model.ts
  - Integrate with observation processing

#### 1.3 Observation Queue
- [ ] **T1.3.1** Create observation queue structure
  - Priority queue with timestamps
  - Deduplication
  - Rate limiting

- [ ] **T1.3.2** Implement thought adapter (direct input)
  - CLI interface for manual thoughts
  - Batch input support

- [ ] **T1.3.3** Implement clipboard adapter (future)
  - Watch clipboard for interesting content
  - Filter noise

- [ ] **T1.3.4** Implement browser adapter (future)
  - Browser extension or history reading
  - URL categorization

#### 1.4 Living Core Loop
- [ ] **T1.4.1** Implement heartbeat loop
  - Configurable interval
  - Graceful shutdown
  - Error recovery

- [ ] **T1.4.2** Implement observation processing
  - Concept extraction
  - World model integration
  - Conflict detection

- [ ] **T1.4.3** Implement maintenance tasks
  - Memory decay
  - Index rebuilding
  - Stale data cleanup

### Phase 2: Research Engine

#### 2.1 Rabbit Hole Evaluation
- [ ] **T2.1.1** Implement value estimation
  - Based on user interests (from world model)
  - Based on concept connections
  - Based on recency/relevance

- [ ] **T2.1.2** Implement cost estimation
  - Estimated time/resources
  - Complexity of topic
  - Available sources

- [ ] **T2.1.3** Implement depth recommendation
  - Skim vs read vs deep-dive
  - Based on value/cost ratio

#### 2.2 Actual Research Capabilities
- [ ] **T2.2.1** Implement web search
  - Multiple search providers
  - Result parsing and extraction
  - Source credibility scoring

- [ ] **T2.2.2** Implement repo analysis
  - Clone and analyze repos
  - Extract patterns and insights
  - Evaluate code quality

- [ ] **T2.2.3** Implement paper reading
  - arxiv/PDF parsing
  - Key insight extraction
  - Citation following

- [ ] **T2.2.4** Implement synthesis
  - Combine findings across sources
  - Generate coherent insights
  - Connect to existing knowledge

#### 2.3 Research Logging
- [ ] **T2.3.1** Log all research actions
  - What was searched
  - What was found
  - What was synthesized

- [ ] **T2.3.2** Track research outcomes
  - Was it valuable?
  - Did it connect to other knowledge?
  - User feedback

### Phase 3: Coherence & Questions

#### 3.1 Conflict Detection
- [ ] **T3.1.1** Detect belief conflicts
  - New observation vs existing belief
  - Confidence-weighted comparison

- [ ] **T3.1.2** Detect pattern conflicts
  - New pattern vs established pattern
  - Exception vs contradiction

#### 3.2 Question Generation
- [ ] **T3.2.1** Generate smart questions (2-5)
  - Targeted at specific conflict
  - Multiple choice with "other" option
  - Importance ranking

- [ ] **T3.2.2** Question queue management
  - Batch related questions
  - Priority by importance
  - Cooldown to avoid nagging

#### 3.3 Conflict Resolution
- [ ] **T3.3.1** Apply user answers
  - Update beliefs
  - Adjust confidence
  - Log resolution

### Phase 4: Card Generation

#### 4.1 Meaningful Card Criteria
- [ ] **T4.1.1** Define "meaningful" thresholds
  - Minimum research depth
  - Minimum confidence
  - Minimum novelty

- [ ] **T4.1.2** Implement card filtering
  - No fake/placeholder cards
  - Must have real evidence

#### 4.2 Card Types
- [ ] **T4.2.1** Research brief cards
  - Summary of research done
  - Key findings
  - Sources

- [ ] **T4.2.2** Decision memo cards
  - Recommendation
  - Trade-offs
  - Next steps

- [ ] **T4.2.3** Connection cards
  - Unexpected insight
  - Path between concepts
  - Why it matters

- [ ] **T4.2.4** Question cards
  - Clarification needed
  - Options
  - Context

### Phase 5: Habit Learning

#### 5.1 Feedback Collection
- [ ] **T5.1.1** Track card engagement
  - Was it read?
  - Was it acted upon?
  - Was it dismissed?

- [ ] **T5.1.2** Track research value
  - Did research lead to insight?
  - Was depth appropriate?

#### 5.2 Pattern Learning
- [ ] **T5.2.1** Learn value threshold
  - What topics get explored?
  - What gets skipped?

- [ ] **T5.2.2** Learn depth preference
  - How deep does user typically go?
  - By topic area

- [ ] **T5.2.3** Learn source trust
  - Which sources are trusted?
  - Which are dismissed?

### Phase 6: Integration & Unification

#### 6.1 Wire Existing Modules
- [ ] **T6.1.1** Integrate anticipation_engine.ts
  - Feed anticipations into observation queue
  - Use for proactive research

- [ ] **T6.1.2** Integrate attention_inference.ts
  - Adjust heartbeat based on ADHD state
  - Modify interruption behavior

- [ ] **T6.1.3** Integrate self_evolution.ts
  - Learn from research outcomes
  - Update prediction rules

- [ ] **T6.1.4** Integrate drives.ts
  - Drive-based prioritization
  - Curiosity satisfaction

#### 6.2 Unified API
- [ ] **T6.2.1** Single entry point for observations
  - All sources go through same path

- [ ] **T6.2.2** Single card output
  - All card types from same generator

- [ ] **T6.2.3** Single question interface
  - All questions through same system

### Phase 7: Persistence & State

#### 7.1 Continuous Operation
- [ ] **T7.1.1** Daemon mode
  - Run as background service
  - Survive restarts

- [ ] **T7.1.2** State recovery
  - Resume from last state
  - Handle interrupted research

#### 7.2 Sync & Backup
- [ ] **T7.2.1** Database backup
  - Periodic snapshots
  - Recovery testing

- [ ] **T7.2.2** Export/import
  - Portable knowledge base
  - Migration support

---

## Part 6: Success Criteria

### The System is Working When:

1. **I can type a thought and it gets processed**
   - Not just stored, but integrated
   - Concepts extracted and linked
   - Conflicts detected

2. **It actually researches without being asked**
   - Web searches happen
   - Repos get analyzed
   - Papers get read

3. **Cards come back with REAL content**
   - Actual URLs visited
   - Real code analyzed
   - Genuine insights, not templates

4. **It asks smart questions when confused**
   - 2-5 targeted questions
   - Relevant to actual conflicts
   - Resolves ambiguity

5. **It learns my patterns**
   - Knows what I find valuable
   - Adjusts depth appropriately
   - Improves over time

6. **It runs continuously**
   - Heartbeat keeps going
   - Survives restarts
   - Processes observations overnight

---

## Part 7: Anti-Patterns to Avoid

### DO NOT:

1. **Generate fake output**
   - No placeholder "research cards"
   - No templated responses
   - If no research done, no card generated

2. **Build more disconnected tools**
   - Everything must flow through Living Core
   - No standalone scripts
   - Single unified system

3. **Wait for commands**
   - System is proactive
   - Heartbeat runs regardless
   - Research happens autonomously

4. **Store without integration**
   - Every observation integrates into world model
   - Conflicts are detected
   - Knowledge graph updates

5. **Ignore the user's patterns**
   - Learn from behavior
   - Adapt to preferences
   - Personalize everything

---

## Part 8: File Structure

```
/worktrees/afrog33k/dexter/
├── services/api/src/
│   ├── core/                      # THE LIVING SYSTEM
│   │   ├── living_core.ts         # Main heartbeat loop
│   │   ├── world_model.ts         # Unified knowledge storage
│   │   ├── observation_stream.ts  # Input processing
│   │   ├── research_engine.ts     # Actual research
│   │   ├── coherence_checker.ts   # Conflict detection
│   │   ├── card_generator.ts      # Meaningful output
│   │   └── habit_learner.ts       # Pattern learning
│   │
│   ├── adapters/                  # Observation sources
│   │   ├── thought_adapter.ts     # Direct input
│   │   ├── clipboard_adapter.ts   # Clipboard watching
│   │   ├── browser_adapter.ts     # Browser history
│   │   └── code_adapter.ts        # File changes
│   │
│   └── lib/                       # Existing modules (to integrate)
│       ├── bdi_model.ts           # Wire into world_model
│       ├── anticipation_engine.ts # Wire into observation_stream
│       ├── attention_inference.ts # Wire into living_core
│       ├── self_evolution.ts      # Wire into habit_learner
│       └── drives.ts              # Wire into living_core
│
├── research/
│   ├── RONALD_GI_MASTER_PLAN.md   # This document
│   ├── SOTA_COMPARISON.md         # Research validation
│   └── experiments/               # Validation experiments
│
└── data/
    └── ronald.db                  # SQLite brain
```

---

## Part 9: Next Immediate Steps

1. **Read and internalize this document**
2. **Start with T1.4.1: Implement heartbeat loop**
   - This is the life of the system
   - Everything else plugs into it
3. **Then T1.1.1: Design unified schema**
   - The brain structure
4. **Then T1.3.2: Thought adapter**
   - First input source
5. **Then T2.2.1: Web search**
   - First actual research capability

---

## Appendix: Reference Implementation (AGI Memory)

Key files from AGI Memory to study:
- `worker.py` - The heartbeat loop implementation
- `cognitive_memory_api.py` - The `hydrate()` function and memory operations
- `schema.sql` - The database structure

Key patterns:
- Database as the brain (not objects in memory)
- Workers as consciousness (heartbeat) and subconsciousness (maintenance)
- `hydrate()` enriches every interaction with context
- Actions are real operations, not text generation
- Everything is logged and auditable

---

**This document is the source of truth for Ronald-GI development.**

When in doubt, refer here. When the vision seems unclear, read Part 1 again.

The goal is simple: **Build a living research colleague, not a collection of tools.**
