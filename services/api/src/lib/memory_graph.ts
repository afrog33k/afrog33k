/**
 * Memory Graph Layer
 *
 * Implements graph database functionality on top of SQLite using:
 * - Recursive CTEs for path traversal
 * - JSON storage for node/edge properties
 * - Relationship types: CAUSES, CONTRADICTS, SUPPORTS, BLOCKS, RELATED, DERIVED_FROM
 *
 * Inspired by: simple-graph (dpapathanasiou) and AGI Memory (QuixiAI)
 */

import type { Database } from 'better-sqlite3';

// =============================================================================
// Types
// =============================================================================

export type RelationshipType =
  | 'CAUSES' // X causes Y
  | 'CONTRADICTS' // X contradicts Y (belief conflict)
  | 'SUPPORTS' // X is evidence for Y
  | 'BLOCKS' // X prevents Y
  | 'RELATED' // General association
  | 'DERIVED_FROM' // Y was derived from X (e.g., belief from event)
  | 'TEMPORAL_NEXT' // X happened before Y
  | 'INSTANCE_OF'; // X is an instance of category Y

export type NodeType =
  | 'belief' // From user_beliefs
  | 'desire' // From bdi_user_desires
  | 'intention' // From bdi_user_intentions
  | 'event' // From attention_events
  | 'pattern' // From evolution_patterns
  | 'rule' // From evolution_rules
  | 'concept' // Abstract concept node
  | 'self'; // Self-model node (user identity)

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  properties: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  sourceType: NodeType;
  targetType: NodeType;
  relationship: RelationshipType;
  strength: number; // 0.0 - 1.0
  properties: Record<string, unknown>;
  createdAt: string;
  evidence?: string[]; // IDs of supporting nodes
}

export interface PathResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  depth: number;
  totalStrength: number; // Product of edge strengths along path
}

export interface TraversalOptions {
  maxDepth?: number;
  minStrength?: number;
  relationshipTypes?: RelationshipType[];
  nodeTypes?: NodeType[];
  direction?: 'outgoing' | 'incoming' | 'both';
}

// =============================================================================
// Schema
// =============================================================================

const GRAPH_SCHEMA = `
  -- Graph nodes (references to other tables or standalone concepts)
  CREATE TABLE IF NOT EXISTS graph_nodes (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    label TEXT NOT NULL,
    properties_json TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Graph edges (relationships between nodes)
  CREATE TABLE IF NOT EXISTS graph_edges (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    source_type TEXT NOT NULL,
    target_type TEXT NOT NULL,
    relationship TEXT NOT NULL,
    strength REAL DEFAULT 0.5,
    properties_json TEXT DEFAULT '{}',
    evidence_json TEXT DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (source_id) REFERENCES graph_nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (target_id) REFERENCES graph_nodes(id) ON DELETE CASCADE
  );

  -- Indexes for efficient traversal
  CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges(source_id);
  CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges(target_id);
  CREATE INDEX IF NOT EXISTS idx_graph_edges_relationship ON graph_edges(relationship);
  CREATE INDEX IF NOT EXISTS idx_graph_nodes_type ON graph_nodes(type);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_graph_edges_unique
    ON graph_edges(source_id, target_id, relationship);
`;

// =============================================================================
// Memory Graph Class
// =============================================================================

export class MemoryGraph {
  constructor(private db: Database) {}

  /**
   * Initialize the graph schema
   */
  initialize(): void {
    this.db.exec(GRAPH_SCHEMA);
  }

  // ---------------------------------------------------------------------------
  // Node Operations
  // ---------------------------------------------------------------------------

  /**
   * Create or update a node
   */
  upsertNode(node: Omit<GraphNode, 'createdAt' | 'updatedAt'>): GraphNode {
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO graph_nodes (id, type, label, properties_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type,
        label = excluded.label,
        properties_json = excluded.properties_json,
        updated_at = excluded.updated_at
      RETURNING *
    `);

    const row = stmt.get(
      node.id,
      node.type,
      node.label,
      JSON.stringify(node.properties),
      now,
      now
    ) as Record<string, unknown>;

    return this.rowToNode(row);
  }

  /**
   * Get a node by ID
   */
  getNode(id: string): GraphNode | null {
    const stmt = this.db.prepare('SELECT * FROM graph_nodes WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToNode(row) : null;
  }

  /**
   * Get nodes by type
   */
  getNodesByType(type: NodeType, limit = 100): GraphNode[] {
    const stmt = this.db.prepare(
      'SELECT * FROM graph_nodes WHERE type = ? ORDER BY updated_at DESC LIMIT ?'
    );
    const rows = stmt.all(type, limit) as Record<string, unknown>[];
    return rows.map((r) => this.rowToNode(r));
  }

  /**
   * Delete a node and its edges
   */
  deleteNode(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM graph_nodes WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  // ---------------------------------------------------------------------------
  // Edge Operations
  // ---------------------------------------------------------------------------

  /**
   * Create or update an edge
   */
  upsertEdge(
    edge: Omit<GraphEdge, 'id' | 'createdAt'>
  ): GraphEdge {
    const id = `edge_${edge.sourceId}_${edge.relationship}_${edge.targetId}`;
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO graph_edges (
        id, source_id, target_id, source_type, target_type,
        relationship, strength, properties_json, evidence_json, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id, target_id, relationship) DO UPDATE SET
        strength = excluded.strength,
        properties_json = excluded.properties_json,
        evidence_json = excluded.evidence_json
      RETURNING *
    `);

    const row = stmt.get(
      id,
      edge.sourceId,
      edge.targetId,
      edge.sourceType,
      edge.targetType,
      edge.relationship,
      edge.strength,
      JSON.stringify(edge.properties),
      JSON.stringify(edge.evidence || []),
      now
    ) as Record<string, unknown>;

    return this.rowToEdge(row);
  }

  /**
   * Connect two existing nodes
   */
  connect(
    sourceId: string,
    targetId: string,
    relationship: RelationshipType,
    strength = 0.5,
    properties: Record<string, unknown> = {}
  ): GraphEdge | null {
    const source = this.getNode(sourceId);
    const target = this.getNode(targetId);

    if (!source || !target) {
      return null;
    }

    return this.upsertEdge({
      sourceId,
      targetId,
      sourceType: source.type,
      targetType: target.type,
      relationship,
      strength,
      properties,
      evidence: [],
    });
  }

  /**
   * Get edges from a node
   */
  getOutgoingEdges(nodeId: string, relationship?: RelationshipType): GraphEdge[] {
    let query = 'SELECT * FROM graph_edges WHERE source_id = ?';
    const params: (string | undefined)[] = [nodeId];

    if (relationship) {
      query += ' AND relationship = ?';
      params.push(relationship);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.rowToEdge(r));
  }

  /**
   * Get edges to a node
   */
  getIncomingEdges(nodeId: string, relationship?: RelationshipType): GraphEdge[] {
    let query = 'SELECT * FROM graph_edges WHERE target_id = ?';
    const params: (string | undefined)[] = [nodeId];

    if (relationship) {
      query += ' AND relationship = ?';
      params.push(relationship);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.rowToEdge(r));
  }

  /**
   * Delete an edge
   */
  deleteEdge(sourceId: string, targetId: string, relationship: RelationshipType): boolean {
    const stmt = this.db.prepare(
      'DELETE FROM graph_edges WHERE source_id = ? AND target_id = ? AND relationship = ?'
    );
    const result = stmt.run(sourceId, targetId, relationship);
    return result.changes > 0;
  }

  // ---------------------------------------------------------------------------
  // Graph Traversal (Recursive CTEs)
  // ---------------------------------------------------------------------------

  /**
   * Find all paths between two nodes using recursive CTE
   */
  findPaths(
    startId: string,
    endId: string,
    options: TraversalOptions = {}
  ): PathResult[] {
    const maxDepth = options.maxDepth || 5;
    const minStrength = options.minStrength || 0.0;
    const direction = options.direction || 'outgoing';

    // Build relationship filter
    const relFilter = options.relationshipTypes?.length
      ? `AND e.relationship IN (${options.relationshipTypes.map((r) => `'${r}'`).join(',')})`
      : '';

    // Recursive CTE for path finding
    const query = `
      WITH RECURSIVE paths AS (
        -- Base case: start from the source node
        SELECT
          e.target_id as current_node,
          e.id as edge_id,
          e.source_id || ',' || e.target_id as path,
          e.strength as total_strength,
          1 as depth
        FROM graph_edges e
        WHERE e.source_id = ? ${relFilter}
          AND e.strength >= ?

        UNION ALL

        -- Recursive case: extend the path
        SELECT
          e.target_id,
          e.id,
          p.path || ',' || e.target_id,
          p.total_strength * e.strength,
          p.depth + 1
        FROM graph_edges e
        JOIN paths p ON e.source_id = p.current_node
        WHERE p.depth < ?
          AND p.path NOT LIKE '%' || e.target_id || '%'  -- Prevent cycles
          ${relFilter}
          AND e.strength >= ?
      )
      SELECT path, total_strength, depth
      FROM paths
      WHERE current_node = ?
      ORDER BY total_strength DESC, depth ASC
      LIMIT 10
    `;

    const stmt = this.db.prepare(query);
    const rows = stmt.all(startId, minStrength, maxDepth, minStrength, endId) as Array<{
      path: string;
      total_strength: number;
      depth: number;
    }>;

    return rows.map((row) => {
      const nodeIds = row.path.split(',');
      const nodes = nodeIds.map((id) => this.getNode(id)).filter(Boolean) as GraphNode[];
      const edges = this.getEdgesBetweenNodes(nodeIds);

      return {
        nodes,
        edges,
        depth: row.depth,
        totalStrength: row.total_strength,
      };
    });
  }

  /**
   * Find neighbors of a node within depth
   */
  findNeighbors(
    nodeId: string,
    options: TraversalOptions = {}
  ): GraphNode[] {
    const maxDepth = options.maxDepth || 2;
    const minStrength = options.minStrength || 0.0;
    const direction = options.direction || 'both';

    // Build direction-specific CTE
    let edgeSelect: string;
    if (direction === 'outgoing') {
      edgeSelect = 'SELECT target_id as neighbor FROM graph_edges WHERE source_id = current_id';
    } else if (direction === 'incoming') {
      edgeSelect = 'SELECT source_id as neighbor FROM graph_edges WHERE target_id = current_id';
    } else {
      edgeSelect = `
        SELECT target_id as neighbor FROM graph_edges WHERE source_id = current_id
        UNION
        SELECT source_id as neighbor FROM graph_edges WHERE target_id = current_id
      `;
    }

    const query = `
      WITH RECURSIVE neighbors AS (
        -- Base case
        SELECT id as current_id, 0 as depth
        FROM graph_nodes WHERE id = ?

        UNION

        -- Recursive case
        SELECT e.neighbor, n.depth + 1
        FROM neighbors n
        CROSS JOIN (${edgeSelect}) e
        WHERE n.depth < ?
      )
      SELECT DISTINCT gn.*
      FROM neighbors n
      JOIN graph_nodes gn ON gn.id = n.current_id
      WHERE n.current_id != ?
    `;

    const stmt = this.db.prepare(query);
    const rows = stmt.all(nodeId, maxDepth, nodeId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToNode(r));
  }

  /**
   * Find causes of a belief/event (traverse CAUSES edges backward)
   */
  findCauses(nodeId: string, maxDepth = 3): GraphNode[] {
    return this.traverseBackward(nodeId, 'CAUSES', maxDepth);
  }

  /**
   * Find effects of a belief/event (traverse CAUSES edges forward)
   */
  findEffects(nodeId: string, maxDepth = 3): GraphNode[] {
    return this.traverseForward(nodeId, 'CAUSES', maxDepth);
  }

  /**
   * Find contradictions for a belief
   */
  findContradictions(nodeId: string): GraphNode[] {
    const edges = this.getOutgoingEdges(nodeId, 'CONTRADICTS');
    const incomingEdges = this.getIncomingEdges(nodeId, 'CONTRADICTS');

    const allEdges = [...edges, ...incomingEdges];
    const nodeIds = new Set(
      allEdges.flatMap((e) => [e.sourceId, e.targetId]).filter((id) => id !== nodeId)
    );

    return [...nodeIds].map((id) => this.getNode(id)).filter(Boolean) as GraphNode[];
  }

  /**
   * Find supporting evidence for a belief
   */
  findSupportingEvidence(nodeId: string): GraphNode[] {
    return this.traverseBackward(nodeId, 'SUPPORTS', 2);
  }

  // ---------------------------------------------------------------------------
  // Contradiction Detection
  // ---------------------------------------------------------------------------

  /**
   * Check if adding a belief would create contradictions
   */
  detectContradictions(
    newBeliefContent: string,
    _category: string,
    existingBeliefIds: string[]
  ): Array<{ beliefId: string; reason: string }> {
    const contradictions: Array<{ beliefId: string; reason: string }> = [];

    // Check for explicit CONTRADICTS edges
    for (const beliefId of existingBeliefIds) {
      const node = this.getNode(beliefId);
      if (node) {
        const existing = this.findContradictions(beliefId);
        if (existing.length > 0) {
          contradictions.push({
            beliefId,
            reason: `Existing contradictions: ${existing.map((n) => n.label).join(', ')}`,
          });
        }
      }
    }

    // TODO: Add semantic contradiction detection using embeddings
    // This would compare newBeliefContent embeddings against existing beliefs

    return contradictions;
  }

  /**
   * Mark two beliefs as contradictory
   */
  markContradiction(
    beliefId1: string,
    beliefId2: string,
    reason: string
  ): GraphEdge | null {
    return this.connect(beliefId1, beliefId2, 'CONTRADICTS', 1.0, { reason });
  }

  // ---------------------------------------------------------------------------
  // Belief-Event Linking
  // ---------------------------------------------------------------------------

  /**
   * Link a belief to its source event
   */
  linkBeliefToEvent(beliefId: string, eventId: string, derivationType: string): void {
    // Ensure nodes exist
    const beliefNode = this.getNode(beliefId);
    const eventNode = this.getNode(eventId);

    if (!beliefNode) {
      this.upsertNode({
        id: beliefId,
        type: 'belief',
        label: `Belief ${beliefId}`,
        properties: {},
      });
    }

    if (!eventNode) {
      this.upsertNode({
        id: eventId,
        type: 'event',
        label: `Event ${eventId}`,
        properties: {},
      });
    }

    // Create DERIVED_FROM edge
    this.connect(beliefId, eventId, 'DERIVED_FROM', 1.0, { derivationType });
  }

  /**
   * Link cause and effect
   */
  linkCauseEffect(causeId: string, effectId: string, strength = 0.5): void {
    this.connect(causeId, effectId, 'CAUSES', strength);
  }

  // ---------------------------------------------------------------------------
  // Graph Statistics
  // ---------------------------------------------------------------------------

  /**
   * Get graph statistics
   */
  getStats(): {
    nodeCount: number;
    edgeCount: number;
    nodesByType: Record<NodeType, number>;
    edgesByType: Record<RelationshipType, number>;
  } {
    const nodeCount = (
      this.db.prepare('SELECT COUNT(*) as count FROM graph_nodes').get() as { count: number }
    ).count;

    const edgeCount = (
      this.db.prepare('SELECT COUNT(*) as count FROM graph_edges').get() as { count: number }
    ).count;

    const nodesByType = {} as Record<NodeType, number>;
    const nodeTypeRows = this.db
      .prepare('SELECT type, COUNT(*) as count FROM graph_nodes GROUP BY type')
      .all() as Array<{ type: string; count: number }>;
    for (const row of nodeTypeRows) {
      nodesByType[row.type as NodeType] = row.count;
    }

    const edgesByType = {} as Record<RelationshipType, number>;
    const edgeTypeRows = this.db
      .prepare('SELECT relationship, COUNT(*) as count FROM graph_edges GROUP BY relationship')
      .all() as Array<{ relationship: string; count: number }>;
    for (const row of edgeTypeRows) {
      edgesByType[row.relationship as RelationshipType] = row.count;
    }

    return { nodeCount, edgeCount, nodesByType, edgesByType };
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private rowToNode(row: Record<string, unknown>): GraphNode {
    return {
      id: row.id as string,
      type: row.type as NodeType,
      label: row.label as string,
      properties: JSON.parse((row.properties_json as string) || '{}'),
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  private rowToEdge(row: Record<string, unknown>): GraphEdge {
    return {
      id: row.id as string,
      sourceId: row.source_id as string,
      targetId: row.target_id as string,
      sourceType: row.source_type as NodeType,
      targetType: row.target_type as NodeType,
      relationship: row.relationship as RelationshipType,
      strength: row.strength as number,
      properties: JSON.parse((row.properties_json as string) || '{}'),
      evidence: JSON.parse((row.evidence_json as string) || '[]'),
      createdAt: row.created_at as string,
    };
  }

  private traverseForward(
    startId: string,
    relationship: RelationshipType,
    maxDepth: number
  ): GraphNode[] {
    const query = `
      WITH RECURSIVE traverse AS (
        SELECT target_id as node_id, 1 as depth
        FROM graph_edges
        WHERE source_id = ? AND relationship = ?

        UNION

        SELECT e.target_id, t.depth + 1
        FROM graph_edges e
        JOIN traverse t ON e.source_id = t.node_id
        WHERE t.depth < ? AND e.relationship = ?
      )
      SELECT DISTINCT gn.*
      FROM traverse t
      JOIN graph_nodes gn ON gn.id = t.node_id
    `;

    const stmt = this.db.prepare(query);
    const rows = stmt.all(startId, relationship, maxDepth, relationship) as Record<
      string,
      unknown
    >[];
    return rows.map((r) => this.rowToNode(r));
  }

  private traverseBackward(
    startId: string,
    relationship: RelationshipType,
    maxDepth: number
  ): GraphNode[] {
    const query = `
      WITH RECURSIVE traverse AS (
        SELECT source_id as node_id, 1 as depth
        FROM graph_edges
        WHERE target_id = ? AND relationship = ?

        UNION

        SELECT e.source_id, t.depth + 1
        FROM graph_edges e
        JOIN traverse t ON e.target_id = t.node_id
        WHERE t.depth < ? AND e.relationship = ?
      )
      SELECT DISTINCT gn.*
      FROM traverse t
      JOIN graph_nodes gn ON gn.id = t.node_id
    `;

    const stmt = this.db.prepare(query);
    const rows = stmt.all(startId, relationship, maxDepth, relationship) as Record<
      string,
      unknown
    >[];
    return rows.map((r) => this.rowToNode(r));
  }

  private getEdgesBetweenNodes(nodeIds: string[]): GraphEdge[] {
    if (nodeIds.length < 2) return [];

    const edges: GraphEdge[] = [];
    for (let i = 0; i < nodeIds.length - 1; i++) {
      const stmt = this.db.prepare(
        'SELECT * FROM graph_edges WHERE source_id = ? AND target_id = ?'
      );
      const rows = stmt.all(nodeIds[i], nodeIds[i + 1]) as Record<string, unknown>[];
      edges.push(...rows.map((r) => this.rowToEdge(r)));
    }
    return edges;
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createMemoryGraph(db: Database): MemoryGraph {
  const graph = new MemoryGraph(db);
  graph.initialize();
  return graph;
}
