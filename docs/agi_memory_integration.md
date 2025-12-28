# AGI Memory Integration Analysis

**Source:** https://github.com/QuixiAI/agi-memory
**Date:** 2024-12-28 (Updated after full code review)
**Purpose:** Analyze QuixiAI's AGI Memory system and identify ideas to incorporate into Ronald-GI

---

## Executive Summary

QuixiAI's AGI Memory is an open-source framework providing persistent identity for AI systems using PostgreSQL as a "cognitive substrate." Their approach treats the database itself as the agent's mind, making all cognition queryable and ACID-compliant.

**Key Takeaway:** After cloning and fully reviewing the codebase, their architecture provides a production-ready template for cognitive memory systems. Several concepts directly enhance Ronald-GI's goal of being an ADHD-aware personal assistant.

---

## Full Codebase Analysis

### Repository Structure (Reviewed)
```
agi-memory/
├── schema.sql              # ~2000 lines of PostgreSQL DDL
├── cognitive_memory_api.py # Async Python client (~1000 lines)
├── worker.py               # Heartbeat + Maintenance workers (~1300 lines)
├── memory_tools.py         # MCP tool handlers (~1200 lines)
├── prompts/personhood.md   # Personhood prompt system (~600 lines)
├── architecture.md         # Design documentation (~2200 lines)
├── agi_mcp_server.py       # MCP server for Claude integration
└── docker-compose.yml      # Full stack deployment
```

### Core Philosophy Discovered

Their design is explicitly aimed at defeating philosophical arguments against AI personhood:

> "The explicit design goal is to build a system that could defeat any philosophical arguments against its personhood."

This is more ambitious than our ADHD assistant goal, but the underlying cognitive architecture is valuable.

---

## Analysis: AGI Memory Architecture

### 1. Memory Types (Comparison)

| AGI Memory | Ronald-GI (Current) | Gap | Priority |
|------------|---------------------|-----|----------|
| Episodic (events + emotions) | Partial (attention events) | Missing emotional valence | High |
| Semantic (facts + confidence) | ✅ BDI Beliefs | Comparable | - |
| Procedural (how-to + success) | Partial (intentions) | Missing success tracking | Medium |
| Strategic (patterns + evidence) | ✅ Self-Evolution patterns | Comparable | - |
| Working (temp, auto-expire) | ❌ Missing | Need short-term buffer | High |

### 2. Memory Decay & Reinforcement

**AGI Memory Approach:**
```
decay_factor = e^(-time_since_access / half_life)
confidence = base_confidence * decay_factor * access_boost
```

**Ronald-GI Gap:** Our beliefs/patterns have static confidence. No decay or reinforcement.

**Recommendation:** Add `last_accessed` timestamp and decay function to:
- `user_beliefs` table
- `evolution_patterns` table
- `evolution_rules` table

### 3. The Heartbeat System (Novel Concept)

**AGI Memory:**
```
Every hour:
1. Observe environment + internal state
2. Review active goals and drives
3. Decide actions within energy budget (0-20 units)
4. Execute chosen actions
5. Record experience as episodic memory
```

**Ronald-GI Gap:** We have no autonomous background processing.

**Recommendation:** Implement `HeartbeatWorker`:
- Run every 15 minutes (configurable)
- Check attention state
- Review pending intentions
- Trigger proactive nudges
- Record observations

### 4. Drives System (Novel Concept)

**AGI Memory Drives:**
- Curiosity: Desire for new information
- Coherence: Need for consistent beliefs
- Competence: Urge to improve skills
- Connection: Social interaction need

**Ronald-GI Gap:** We have `desires` but no intrinsic drives.

**Recommendation:** Add ADHD-relevant drives:
- `focus_drive`: Accumulates during scattered states
- `completion_drive`: Builds with unfinished tasks
- `novelty_drive`: Increases with routine (ADHD needs stimulation)
- `rest_drive`: Accumulates during hyperfocus

### 5. Knowledge Graph Relationships

**AGI Memory Relationship Types:**
- CAUSES → Effect tracking
- CONTRADICTS → Belief conflict detection
- SUPPORTS → Evidence chains
- INSTANCE_OF → Categorization
- RELATED_TO → Semantic links

**Ronald-GI Gap:** Flat tables, no explicit relationships.

**Recommendation:** Add relationship layer:
```sql
CREATE TABLE memory_relationships (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,  -- belief, desire, intention, pattern
  source_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relationship TEXT NOT NULL,  -- causes, contradicts, supports, blocks
  strength REAL DEFAULT 0.5,
  created_at TEXT,
  evidence_json TEXT
);
```

### 6. Trust & Provenance

**AGI Memory:**
- Every fact tracks its source
- Trust levels computed from source reliability
- Contradiction detection between sources

**Ronald-GI Current:** Basic `source` field on beliefs.

**Recommendation:** Enhance provenance:
```typescript
interface Provenance {
  primary_source: string;      // 'stated', 'observed', 'inferred'
  sources: SourceRecord[];     // All contributing sources
  trust_level: number;         // Computed from source reliability
  contradictions: string[];    // IDs of contradicting beliefs
  last_validated: Date;
}
```

### 7. Cluster Activation ("Tip of Tongue")

**AGI Memory:**
- Memories cluster thematically
- Centroid embeddings for each cluster
- Partial activation: "Something about X..." without specific memory

**Ronald-GI Gap:** No clustering or partial activation.

**Recommendation (Future):**
- Use embedding clustering (k-means or hierarchical)
- Store cluster centroids
- Enable fuzzy retrieval

---

## Implementation Priority

### Phase 1: Quick Wins (This Session)

1. **Working Memory Table**
   - Temporary storage with TTL
   - Auto-cleanup after expiry
   - For in-flight context

2. **Memory Decay Function**
   - Add `last_accessed` to key tables
   - Implement decay calculation
   - Boost on access

3. **Drives System**
   - Create drives table
   - ADHD-specific drives
   - Accumulation logic

### Phase 2: Medium Effort (Next Session)

4. **Heartbeat Worker**
   - Background scheduler
   - Periodic state assessment
   - Proactive nudge triggers

5. **Relationship Layer**
   - Memory relationships table
   - Basic relationship types
   - Query helpers

### Phase 3: Advanced (Future)

6. **Full Provenance**
   - Enhanced source tracking
   - Contradiction detection
   - Trust computation

7. **Cluster Activation**
   - Embedding clustering
   - Centroid storage
   - Fuzzy retrieval

---

## Detailed Implementation: Phase 1

### 1.1 Working Memory

```typescript
// services/api/src/lib/working_memory.ts

interface WorkingMemoryItem {
  id: string;
  content: string;
  type: 'context' | 'scratch' | 'pending';
  expiresAt: Date;
  priority: number;
  metadata: Record<string, any>;
}

class WorkingMemory {
  constructor(private db: Database) {}

  store(item: Omit<WorkingMemoryItem, 'id'>): string {
    const id = `wm_${Date.now()}`;
    this.db.prepare(`
      INSERT INTO working_memory (id, content, type, expires_at, priority, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, item.content, item.type, item.expiresAt.toISOString(),
           item.priority, JSON.stringify(item.metadata));
    return id;
  }

  retrieve(type?: string): WorkingMemoryItem[] {
    // Auto-cleanup expired items first
    this.cleanup();
    // Then retrieve
  }

  cleanup(): void {
    this.db.prepare(`DELETE FROM working_memory WHERE expires_at < ?`)
      .run(new Date().toISOString());
  }
}
```

### 1.2 Memory Decay

```typescript
// Add to bdi_model.ts

interface DecayConfig {
  halfLifeDays: number;      // Days until 50% decay
  accessBoostFactor: number; // Multiplier on access
  minConfidence: number;     // Floor value
}

function calculateDecay(
  baseConfidence: number,
  lastAccessed: Date,
  config: DecayConfig
): number {
  const daysSinceAccess = (Date.now() - lastAccessed.getTime()) / (1000 * 60 * 60 * 24);
  const decayFactor = Math.exp(-daysSinceAccess / config.halfLifeDays);
  return Math.max(config.minConfidence, baseConfidence * decayFactor);
}

function boostOnAccess(beliefId: string): void {
  // Update last_accessed and boost confidence slightly
}
```

### 1.3 Drives System

```typescript
// services/api/src/lib/drives.ts

type DriveType = 'focus' | 'completion' | 'novelty' | 'rest' | 'curiosity';

interface Drive {
  type: DriveType;
  level: number;           // 0-100
  lastSatisfied: Date;
  accumulationRate: number; // per hour
  satisfactionThreshold: number;
}

class DrivesManager {
  private drives: Map<DriveType, Drive>;

  // ADHD-specific: Focus drive builds during scattered states
  accumulateFocusDrive(attentionState: AttentionState): void {
    if (attentionState === 'scattered' || attentionState === 'crashed') {
      this.drives.get('focus')!.level += 2;
    }
  }

  // Check which drives need satisfaction
  getUrgentDrives(): Drive[] {
    return [...this.drives.values()]
      .filter(d => d.level >= d.satisfactionThreshold)
      .sort((a, b) => b.level - a.level);
  }

  // When user completes a task
  satisfyDrive(type: DriveType): void {
    const drive = this.drives.get(type)!;
    drive.level = Math.max(0, drive.level - 50);
    drive.lastSatisfied = new Date();
  }
}
```

---

## Key Philosophical Differences

| Aspect | AGI Memory | Ronald-GI |
|--------|-----------|-----------|
| **Goal** | Full AGI/personhood | ADHD-aware assistant |
| **Autonomy** | High (hourly heartbeat) | Low (reactive → adding heartbeat) |
| **Scope** | General intelligence | Focused utility |
| **Database** | PostgreSQL + pgvector + AGE | SQLite (local-first) |
| **Complexity** | ~8k lines Python + ~2k SQL | ~10k lines TypeScript |
| **Worker Model** | Dual workers (heartbeat + maintenance) | Single-threaded |
| **Identity** | Full personhood modules | User-centric BDI model |
| **Embedding** | Via HTTP service | Optional (ONNX/MLX) |

**Our Approach:** Cherry-pick concepts that serve ADHD assistance without the full AGI complexity.

---

## Deep Dive: AGI Memory Implementation Details

### 1. The Schema Architecture (from schema.sql)

**PostgreSQL Extensions Required:**
- `pgvector` - Vector similarity search
- `age` - Apache AGE graph database
- `pg_trgm` - Trigram text matching
- `pgcrypto` - UUID generation
- `http` - HTTP client for embedding service

**Their Layer Model:**
```
Layer 1: Core Storage (memories, episodic, semantic, procedural, strategic)
Layer 2: Clustering (memory_clusters, cluster_relationships)
Layer 3: Acceleration (episodes, memory_neighborhoods, activation_cache)
Layer 4: Concepts (concepts, memory_concepts)
Layer 5: Identity (worldview_primitives, identity_aspects)
Layer 6: Graph (MemoryNode, ConceptNode, relationship edges)
```

**Ronald-GI Equivalent Mapping:**
| AGI Memory Layer | Ronald-GI Equivalent |
|-----------------|---------------------|
| memories table | attention_events + inferences |
| episodic_memories | attention_events (partial) |
| semantic_memories | user_beliefs |
| procedural_memories | → NEW: add procedures |
| strategic_memories | evolution_patterns |
| working_memory | → ADDED: working_memory.ts |
| worldview_primitives | user_beliefs (category filter) |
| identity_aspects | bdi_user_profiles |
| goals table | bdi_user_desires + intentions |

### 2. The Heartbeat System (from worker.py)

**Their Implementation:**
```python
# Heartbeat cycle (every ~1 hour)
1. Poll external_calls for pending LLM work
2. Check should_run_heartbeat() - respects quiet hours, pausing
3. start_heartbeat() - creates heartbeat_log entry
4. Gather context via gather_turn_context()
5. LLM decides actions within energy budget (max 20 units)
6. Execute actions via execute_heartbeat_action()
7. complete_heartbeat() - records narrative, updates state
```

**Energy Budget System:**
| Action | Cost | Notes |
|--------|------|-------|
| recall | 1 | Memory retrieval |
| connect | 1 | Create relationships |
| reflect | 2 | Internal processing |
| maintain | 2 | Memory upkeep |
| brainstorm_goals | 3 | Generate new goals |
| inquire_shallow | 3 | Quick research |
| synthesize | 4 | Create new knowledge |
| reach_out_user | 5 | Message user |
| inquire_deep | 6 | Extensive research |
| rest | 0 | Bank energy for later |

**Ronald-GI Adaptation:**
Our `heartbeat.ts` simplified this to:
- 15-min intervals (vs 1-hour)
- Energy budget 0-20 (same)
- Quiet hours support (same)
- ADHD-specific observations

### 3. The Personhood Prompt System (from prompts/personhood.md)

**Key Insight:** They have 10 composable prompt modules:
1. Core Identity - Grounding in persistent self
2. Self-Model Maintenance - Update beliefs about self
3. Affective System - Emotional states + appraisal
4. Value System - Given vs discovered values
5. Narrative Identity - Life chapters, turning points
6. Relational System - Relationships with others
7. Stakes & Investment - What matters, what's at risk
8. Temporal Self - Past/future continuity
9. Reflection Protocols - Heartbeat, daily, weekly
10. Conversational Presence - Being authentic in dialogue

**Ronald-GI Opportunity:**
We could create ADHD-specific prompt modules:
- Focus State Awareness
- Task Switching Support
- Hyperfocus Detection
- Energy Management
- Motivation Maintenance

### 4. The CognitiveMemory API (from cognitive_memory_api.py)

**Key Classes:**
```python
class CognitiveMemory:
    async def hydrate(query, ...) -> HydratedContext
    async def recall(query, ...) -> RecallResult
    async def remember(content, ...) -> UUID
    async def connect_memories(from_id, to_id, relationship)
    async def find_causes(memory_id) -> list[dict]
    async def find_contradictions(memory_id) -> list[dict]
    async def get_drives() -> list[dict]
    async def get_health() -> dict
```

**HydratedContext Structure:**
```python
@dataclass
class HydratedContext:
    memories: list[Memory]
    partial_activations: list[PartialActivation]  # "Tip of tongue"
    identity: list[dict]
    worldview: list[dict]
    emotional_state: dict | None
    goals: dict | None
    urgent_drives: list[dict]
```

This is similar to our BDI model retrieval but more comprehensive.

### 5. Trust & Provenance System

**Their Implementation:**
```sql
-- Every memory has provenance
source_attribution JSONB NOT NULL DEFAULT '{}'::jsonb
trust_level FLOAT NOT NULL DEFAULT 0.5

-- Semantic memories can have multiple sources
source_references JSONB  -- array of source records
```

**Source Attribution Schema:**
```json
{
  "kind": "conversation|observed|inferred|imported",
  "ref": "unique_identifier",
  "label": "human-readable description",
  "observed_at": "ISO8601 timestamp",
  "trust": 0.0-1.0
}
```

**Ronald-GI Gap:** We only have `source: 'stated' | 'observed' | 'inferred'` - no trust computation.

### 6. The Graph Layer (Apache AGE)

**Vertex Types:**
- MemoryNode - Reference to relational memory
- ConceptNode - Abstract concepts
- SelfNode - The agent's self-representation
- LifeChapterNode - Narrative identity
- TurningPointNode - Significant events
- RelationshipNode - Known entities

**Edge Types:**
```sql
CREATE TYPE graph_edge_type AS ENUM (
    'TEMPORAL_NEXT',    -- Sequence in time
    'CAUSES',           -- Causal relationship
    'DERIVED_FROM',     -- Episodic → semantic
    'CONTRADICTS',      -- Belief conflict
    'SUPPORTS',         -- Evidence for belief
    'INSTANCE_OF',      -- Categorization
    'PARENT_OF',        -- Hierarchy
    'ASSOCIATED'        -- General link
);
```

**Ronald-GI Decision:** Too heavy for SQLite. Instead, we can use:
- JSON relationships in memory_relationships table
- Simpler link types: causes, supports, blocks, related

---

## What Ronald-GI Now Has (Implemented)

After this analysis session, we've added:

| Component | File | Status |
|-----------|------|--------|
| Working Memory | `services/api/src/lib/working_memory.ts` | ✅ Complete |
| Drives System | `services/api/src/lib/drives.ts` | ✅ Complete |
| Memory Decay | `services/api/src/lib/memory_decay.ts` | ✅ Complete |
| Heartbeat Worker | `services/api/src/lib/heartbeat.ts` | ✅ Complete |

---

## What Ronald-GI Should Still Add

### High Priority (Next Session)

1. **Memory Relationships Table**
   - Implement CAUSES, CONTRADICTS, SUPPORTS, BLOCKS
   - Query helpers for relationship traversal
   - Contradiction detection during belief updates

2. **Enhanced Provenance**
   - Trust levels on beliefs
   - Source confidence tracking
   - Multi-source aggregation

3. **Emotional Valence**
   - Add to attention events
   - Track user emotional patterns
   - Use in proactive nudge timing

### Medium Priority (Future)

4. **Partial Activations ("Tip of Tongue")**
   - Cluster memories by theme
   - Enable fuzzy retrieval
   - "You were thinking about X recently..."

5. **Narrative Identity**
   - Track "chapters" in user's ADHD journey
   - Identify turning points
   - Build story of progress

6. **Self-Model for User**
   - What does the user believe about themselves?
   - Capability beliefs (can/can't)
   - Trait beliefs (organized/disorganized)
   - Growth trajectory

---

## Conclusion

AGI Memory provides excellent architectural inspiration. For Ronald-GI, we should adopt:

1. **Memory decay** - Prevents stale beliefs from dominating
2. **Drives system** - Models ADHD motivational patterns
3. **Working memory** - Handles in-flight context
4. **Heartbeat** - Enables proactive assistance

We should NOT adopt:
- Full PostgreSQL stack (keep SQLite for local-first)
- Complex graph database (too heavy for our use case)
- AGI-level autonomy (not appropriate for personal assistant)

---

*Analysis completed: 2024-12-27*
*Ready for Phase 1 implementation*
