# AGI Memory Integration Analysis

**Source:** https://github.com/QuixiAI/agi-memory
**Date:** 2024-12-27
**Purpose:** Analyze QuixiAI's AGI Memory system and identify ideas to incorporate into Ronald-GI

---

## Executive Summary

QuixiAI's AGI Memory is an open-source framework providing persistent identity for AI systems using PostgreSQL as a "cognitive substrate." Their approach treats the database itself as the agent's mind, making all cognition queryable.

**Key Takeaway:** Their architecture is more ambitious (full AGI) but several concepts directly enhance Ronald-GI's goal of being an ADHD-aware personal assistant.

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
| **Autonomy** | High (hourly heartbeat) | Low (reactive) |
| **Scope** | General intelligence | Focused utility |
| **Database** | PostgreSQL + extensions | SQLite (local-first) |
| **Complexity** | ~50k lines | ~5k lines |

**Our Approach:** Cherry-pick concepts that serve ADHD assistance without the full AGI complexity.

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
