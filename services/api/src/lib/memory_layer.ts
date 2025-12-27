/**
 * Mem0-inspired Hybrid Memory Layer for Ronald-GI
 *
 * Research finding: Mem0's hybrid datastore architecture combines graph, vector,
 * and key-value stores, achieving 26% accuracy boost over baseline approaches.
 *
 * This implementation provides:
 * 1. Graph Store - Relationship-based memory (concept connections, entity relations)
 * 2. Vector Store - Semantic similarity search (embedding-based recall)
 * 3. Key-Value Store - Fast associative lookups (user preferences, session state)
 *
 * The Memory Manager coordinates across all three for optimal recall.
 */

import Database from 'better-sqlite3';

// ============================================
// MEMORY TYPES
// ============================================

export interface Memory {
  id: string;
  type: 'fact' | 'preference' | 'behavior' | 'relationship' | 'context';
  content: string;
  metadata: Record<string, any>;
  embedding?: number[];
  createdAt: string;
  accessedAt: string;
  accessCount: number;
  decayScore: number; // 0-1, higher = more likely to be forgotten
}

export interface GraphNode {
  id: string;
  label: string;
  type: 'concept' | 'entity' | 'behavior' | 'preference';
  properties: Record<string, any>;
}

export interface GraphEdge {
  source: string;
  target: string;
  relation: string;
  weight: number;
  createdAt: string;
}

export interface MemoryQuery {
  text?: string;
  type?: Memory['type'];
  limit?: number;
  minRelevance?: number;
  includeDecayed?: boolean;
}

export interface MemoryResult {
  memory: Memory;
  relevance: number;
  source: 'graph' | 'vector' | 'kv';
}

// ============================================
// GRAPH STORE
// ============================================

export class GraphStore {
  constructor(private db: Database.Database) {
    this.ensureTables();
  }

  private ensureTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_nodes (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        type TEXT NOT NULL,
        properties_json TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS memory_edges (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relation TEXT NOT NULL,
        weight REAL DEFAULT 1.0,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (source_id) REFERENCES memory_nodes(id),
        FOREIGN KEY (target_id) REFERENCES memory_nodes(id)
      );

      CREATE INDEX IF NOT EXISTS idx_edges_source ON memory_edges(source_id);
      CREATE INDEX IF NOT EXISTS idx_edges_target ON memory_edges(target_id);
      CREATE INDEX IF NOT EXISTS idx_edges_relation ON memory_edges(relation);
    `);
  }

  /**
   * Add or update a node in the graph
   */
  upsertNode(node: GraphNode): void {
    this.db.prepare(`
      INSERT INTO memory_nodes (id, label, type, properties_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        label = excluded.label,
        properties_json = excluded.properties_json,
        updated_at = datetime('now')
    `).run(node.id, node.label, node.type, JSON.stringify(node.properties));
  }

  /**
   * Add or strengthen an edge between nodes
   */
  upsertEdge(edge: GraphEdge): void {
    const edgeId = `${edge.source}_${edge.relation}_${edge.target}`;

    // Check existing weight
    const existing = this.db.prepare(
      'SELECT weight FROM memory_edges WHERE id = ?'
    ).get(edgeId) as { weight: number } | undefined;

    const newWeight = existing
      ? Math.min(2.0, existing.weight + edge.weight * 0.1) // Strengthen existing
      : edge.weight;

    this.db.prepare(`
      INSERT INTO memory_edges (id, source_id, target_id, relation, weight)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET weight = ?
    `).run(edgeId, edge.source, edge.target, edge.relation, newWeight, newWeight);
  }

  /**
   * Find related nodes via graph traversal
   */
  findRelated(nodeId: string, maxDepth: number = 2, limit: number = 20): GraphNode[] {
    // BFS traversal up to maxDepth
    const visited = new Set<string>([nodeId]);
    const queue: { id: string; depth: number }[] = [{ id: nodeId, depth: 0 }];
    const results: GraphNode[] = [];

    while (queue.length > 0 && results.length < limit) {
      const current = queue.shift()!;
      if (current.depth >= maxDepth) continue;

      // Get neighbors
      const neighbors = this.db.prepare(`
        SELECT n.id, n.label, n.type, n.properties_json, e.weight
        FROM memory_edges e
        JOIN memory_nodes n ON
          (e.target_id = n.id AND e.source_id = ?) OR
          (e.source_id = n.id AND e.target_id = ?)
        WHERE n.id != ?
        ORDER BY e.weight DESC
        LIMIT 10
      `).all(current.id, current.id, nodeId) as any[];

      for (const neighbor of neighbors) {
        if (!visited.has(neighbor.id)) {
          visited.add(neighbor.id);
          results.push({
            id: neighbor.id,
            label: neighbor.label,
            type: neighbor.type,
            properties: JSON.parse(neighbor.properties_json || '{}'),
          });
          queue.push({ id: neighbor.id, depth: current.depth + 1 });
        }
      }
    }

    return results;
  }

  /**
   * Find paths between two nodes
   */
  findPaths(sourceId: string, targetId: string, maxLength: number = 4): string[][] {
    const paths: string[][] = [];
    const visited = new Set<string>();

    const dfs = (current: string, path: string[]): void => {
      if (path.length > maxLength) return;
      if (current === targetId) {
        paths.push([...path]);
        return;
      }
      if (visited.has(current)) return;

      visited.add(current);

      const neighbors = this.db.prepare(`
        SELECT target_id FROM memory_edges WHERE source_id = ?
        UNION
        SELECT source_id FROM memory_edges WHERE target_id = ?
      `).all(current, current) as { target_id?: string; source_id?: string }[];

      for (const n of neighbors) {
        const nextId = n.target_id || n.source_id!;
        dfs(nextId, [...path, nextId]);
      }

      visited.delete(current);
    };

    dfs(sourceId, [sourceId]);
    return paths.slice(0, 5); // Limit paths returned
  }

  /**
   * Get strongly connected clusters (communities)
   */
  getClusters(minSize: number = 3): GraphNode[][] {
    // Simple connected components algorithm
    const nodes = this.db.prepare('SELECT id FROM memory_nodes').all() as { id: string }[];
    const visited = new Set<string>();
    const clusters: GraphNode[][] = [];

    for (const node of nodes) {
      if (visited.has(node.id)) continue;

      const cluster: GraphNode[] = [];
      const stack = [node.id];

      while (stack.length > 0) {
        const current = stack.pop()!;
        if (visited.has(current)) continue;
        visited.add(current);

        const nodeData = this.db.prepare(
          'SELECT * FROM memory_nodes WHERE id = ?'
        ).get(current) as any;

        if (nodeData) {
          cluster.push({
            id: nodeData.id,
            label: nodeData.label,
            type: nodeData.type,
            properties: JSON.parse(nodeData.properties_json || '{}'),
          });
        }

        const neighbors = this.db.prepare(`
          SELECT target_id as id FROM memory_edges WHERE source_id = ?
          UNION
          SELECT source_id as id FROM memory_edges WHERE target_id = ?
        `).all(current, current) as { id: string }[];

        for (const n of neighbors) {
          if (!visited.has(n.id)) stack.push(n.id);
        }
      }

      if (cluster.length >= minSize) {
        clusters.push(cluster);
      }
    }

    return clusters.sort((a, b) => b.length - a.length);
  }
}

// ============================================
// KEY-VALUE STORE
// ============================================

export class KeyValueStore {
  constructor(private db: Database.Database) {
    this.ensureTable();
  }

  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_kv (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        type TEXT DEFAULT 'generic',
        expires_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_kv_type ON memory_kv(type);
      CREATE INDEX IF NOT EXISTS idx_kv_expires ON memory_kv(expires_at);
    `);
  }

  /**
   * Set a value
   */
  set(key: string, value: any, type: string = 'generic', ttlSeconds?: number): void {
    const expiresAt = ttlSeconds
      ? new Date(Date.now() + ttlSeconds * 1000).toISOString()
      : null;

    this.db.prepare(`
      INSERT INTO memory_kv (key, value_json, type, expires_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        type = excluded.type,
        expires_at = excluded.expires_at,
        updated_at = datetime('now')
    `).run(key, JSON.stringify(value), type, expiresAt);
  }

  /**
   * Get a value
   */
  get<T = any>(key: string): T | null {
    const row = this.db.prepare(`
      SELECT value_json FROM memory_kv
      WHERE key = ?
        AND (expires_at IS NULL OR expires_at > datetime('now'))
    `).get(key) as { value_json: string } | undefined;

    return row ? JSON.parse(row.value_json) : null;
  }

  /**
   * Get all values of a type
   */
  getByType<T = any>(type: string): Array<{ key: string; value: T }> {
    const rows = this.db.prepare(`
      SELECT key, value_json FROM memory_kv
      WHERE type = ?
        AND (expires_at IS NULL OR expires_at > datetime('now'))
      ORDER BY updated_at DESC
    `).all(type) as { key: string; value_json: string }[];

    return rows.map(r => ({
      key: r.key,
      value: JSON.parse(r.value_json),
    }));
  }

  /**
   * Delete a value
   */
  delete(key: string): boolean {
    const result = this.db.prepare('DELETE FROM memory_kv WHERE key = ?').run(key);
    return result.changes > 0;
  }

  /**
   * Clean up expired entries
   */
  cleanup(): number {
    const result = this.db.prepare(
      "DELETE FROM memory_kv WHERE expires_at IS NOT NULL AND expires_at < datetime('now')"
    ).run();
    return result.changes;
  }

  /**
   * Increment a counter
   */
  increment(key: string, by: number = 1): number {
    const current = this.get<number>(key) || 0;
    const newValue = current + by;
    this.set(key, newValue, 'counter');
    return newValue;
  }
}

// ============================================
// VECTOR STORE (Semantic Memory)
// ============================================

export class VectorStore {
  constructor(private db: Database.Database) {
    this.ensureTable();
  }

  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_vectors (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        type TEXT NOT NULL,
        embedding_json TEXT,
        metadata_json TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        accessed_at TEXT DEFAULT (datetime('now')),
        access_count INTEGER DEFAULT 0,
        decay_score REAL DEFAULT 0.0
      );

      CREATE INDEX IF NOT EXISTS idx_vectors_type ON memory_vectors(type);
      CREATE INDEX IF NOT EXISTS idx_vectors_decay ON memory_vectors(decay_score);
    `);
  }

  /**
   * Store a memory with embedding
   */
  store(memory: Omit<Memory, 'accessedAt' | 'accessCount' | 'decayScore'>): void {
    this.db.prepare(`
      INSERT INTO memory_vectors (id, content, type, embedding_json, metadata_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        content = excluded.content,
        embedding_json = excluded.embedding_json,
        metadata_json = excluded.metadata_json
    `).run(
      memory.id,
      memory.content,
      memory.type,
      memory.embedding ? JSON.stringify(memory.embedding) : null,
      JSON.stringify(memory.metadata)
    );
  }

  /**
   * Search by semantic similarity (cosine distance)
   */
  search(queryEmbedding: number[], type?: string, limit: number = 10): MemoryResult[] {
    // Get all memories with embeddings
    let query = 'SELECT * FROM memory_vectors WHERE embedding_json IS NOT NULL';
    const params: any[] = [];

    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }

    const rows = this.db.prepare(query).all(...params) as any[];

    // Calculate cosine similarity for each
    const results: MemoryResult[] = rows.map(row => {
      const embedding = JSON.parse(row.embedding_json);
      const similarity = this.cosineSimilarity(queryEmbedding, embedding);

      // Apply decay penalty
      const relevance = similarity * (1 - row.decay_score * 0.5);

      return {
        memory: {
          id: row.id,
          content: row.content,
          type: row.type,
          metadata: JSON.parse(row.metadata_json || '{}'),
          embedding,
          createdAt: row.created_at,
          accessedAt: row.accessed_at,
          accessCount: row.access_count,
          decayScore: row.decay_score,
        },
        relevance,
        source: 'vector' as const,
      };
    });

    // Sort by relevance and return top results
    return results
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, limit);
  }

  /**
   * Mark a memory as accessed (reinforcement)
   */
  access(memoryId: string): void {
    this.db.prepare(`
      UPDATE memory_vectors
      SET accessed_at = datetime('now'),
          access_count = access_count + 1,
          decay_score = MAX(0, decay_score - 0.1)  -- Reinforce on access
      WHERE id = ?
    `).run(memoryId);
  }

  /**
   * Apply temporal decay to all memories
   */
  applyDecay(decayRate: number = 0.01): number {
    const result = this.db.prepare(`
      UPDATE memory_vectors
      SET decay_score = MIN(1.0, decay_score + ?)
      WHERE accessed_at < datetime('now', '-7 days')
    `).run(decayRate);
    return result.changes;
  }

  /**
   * Prune highly decayed memories
   */
  prune(maxDecay: number = 0.9): number {
    const result = this.db.prepare(
      'DELETE FROM memory_vectors WHERE decay_score > ?'
    ).run(maxDecay);
    return result.changes;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}

// ============================================
// UNIFIED MEMORY MANAGER
// ============================================

export interface RecallContext {
  userId?: string;
  currentTask?: string;
  recentConcepts?: string[];
  sessionId?: string;
}

export interface RecallResult {
  memories: MemoryResult[];
  graphContext: GraphNode[];
  sessionData: Record<string, any>;
  confidence: number;
}

export class MemoryManager {
  private graph: GraphStore;
  private kv: KeyValueStore;
  private vectors: VectorStore;

  constructor(private db: Database.Database) {
    this.graph = new GraphStore(db);
    this.kv = new KeyValueStore(db);
    this.vectors = new VectorStore(db);
  }

  /**
   * Store a new memory across all stores
   */
  remember(memory: Omit<Memory, 'accessedAt' | 'accessCount' | 'decayScore'>): void {
    // Store in vector store
    this.vectors.store(memory);

    // Add to graph if it has relationships
    if (memory.metadata.concepts) {
      const node: GraphNode = {
        id: memory.id,
        label: memory.content.substring(0, 100),
        type: memory.type === 'relationship' ? 'entity' : memory.type as any,
        properties: memory.metadata,
      };
      this.graph.upsertNode(node);

      // Create edges to concepts
      for (const concept of memory.metadata.concepts) {
        this.graph.upsertEdge({
          source: memory.id,
          target: concept,
          relation: 'mentions',
          weight: 1.0,
          createdAt: new Date().toISOString(),
        });
      }
    }

    // Store quick-access metadata in KV
    if (memory.type === 'preference') {
      this.kv.set(`pref:${memory.id}`, memory.content, 'preference');
    }
  }

  /**
   * Recall memories using all stores (hybrid search)
   */
  async recall(
    query: string,
    embedding: number[] | null,
    context: RecallContext = {},
    limit: number = 10
  ): Promise<RecallResult> {
    const results: MemoryResult[] = [];

    // 1. Vector search (if embedding provided)
    if (embedding) {
      const vectorResults = this.vectors.search(embedding, undefined, limit);
      results.push(...vectorResults);
    }

    // 2. Graph traversal (if we have concept context)
    let graphContext: GraphNode[] = [];
    if (context.recentConcepts && context.recentConcepts.length > 0) {
      for (const concept of context.recentConcepts.slice(0, 3)) {
        const related = this.graph.findRelated(concept, 2, 10);
        graphContext.push(...related);
      }
    }

    // 3. KV lookup for user preferences
    const sessionData: Record<string, any> = {};
    if (context.userId) {
      const prefs = this.kv.getByType<any>('preference');
      for (const pref of prefs.slice(0, 10)) {
        sessionData[pref.key] = pref.value;
      }
    }

    // 4. Session context
    if (context.sessionId) {
      const sessionContext = this.kv.get(`session:${context.sessionId}`);
      if (sessionContext) {
        sessionData.session = sessionContext;
      }
    }

    // Deduplicate and sort by relevance
    const seen = new Set<string>();
    const dedupedResults = results.filter(r => {
      if (seen.has(r.memory.id)) return false;
      seen.add(r.memory.id);
      return true;
    });

    // Calculate confidence based on result quality
    const avgRelevance = dedupedResults.length > 0
      ? dedupedResults.reduce((sum, r) => sum + r.relevance, 0) / dedupedResults.length
      : 0;

    return {
      memories: dedupedResults.slice(0, limit),
      graphContext: graphContext.slice(0, 20),
      sessionData,
      confidence: Math.min(1, avgRelevance + (graphContext.length > 0 ? 0.1 : 0)),
    };
  }

  /**
   * Learn from user interaction
   */
  learnFromInteraction(
    userId: string,
    action: 'click' | 'pin' | 'dismiss' | 'expand' | 'search',
    target: { id: string; type: string; concepts?: string[] },
    value: number = 1.0
  ): void {
    // Update access counts
    this.vectors.access(target.id);

    // Strengthen graph edges
    if (target.concepts) {
      for (const concept of target.concepts) {
        this.graph.upsertEdge({
          source: `user:${userId}`,
          target: concept,
          relation: action,
          weight: value,
          createdAt: new Date().toISOString(),
        });
      }
    }

    // Update interaction counters
    this.kv.increment(`interactions:${userId}:${action}`);
    this.kv.increment(`interactions:${userId}:total`);

    // Track session activity
    const sessionKey = `session:${userId}:${new Date().toISOString().split('T')[0]}`;
    const session = this.kv.get<any>(sessionKey) || { actions: [] };
    session.actions.push({ action, target: target.id, timestamp: Date.now() });
    session.actions = session.actions.slice(-100); // Keep last 100
    this.kv.set(sessionKey, session, 'session', 86400); // 24h TTL
  }

  /**
   * Get user's current focus/context
   */
  getUserFocus(userId: string): { concepts: string[]; behaviors: string[]; recentTopics: string[] } {
    // Get from graph: what concepts is user connected to?
    const userNode = `user:${userId}`;
    const related = this.graph.findRelated(userNode, 1, 50);

    const concepts = related
      .filter(n => n.type === 'concept')
      .map(n => n.label);

    const behaviors = related
      .filter(n => n.type === 'behavior')
      .map(n => n.label);

    // Get recent topics from KV
    const sessionKey = `session:${userId}:${new Date().toISOString().split('T')[0]}`;
    const session = this.kv.get<any>(sessionKey) || { actions: [] };

    const recentTopics = [...new Set(
      session.actions
        .filter((a: any) => a.target)
        .map((a: any) => a.target)
    )].slice(0, 10) as string[];

    return { concepts, behaviors, recentTopics };
  }

  /**
   * Maintenance: apply decay and cleanup
   */
  maintain(): { decayed: number; pruned: number; expired: number } {
    const decayed = this.vectors.applyDecay();
    const pruned = this.vectors.prune();
    const expired = this.kv.cleanup();
    return { decayed, pruned, expired };
  }

  // Expose individual stores for direct access
  getGraphStore(): GraphStore { return this.graph; }
  getKVStore(): KeyValueStore { return this.kv; }
  getVectorStore(): VectorStore { return this.vectors; }
}

// ============================================
// FACTORY
// ============================================

export function createMemoryLayer(db: Database.Database): MemoryManager {
  return new MemoryManager(db);
}
