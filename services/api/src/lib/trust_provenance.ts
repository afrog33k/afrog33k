/**
 * Trust & Provenance System
 *
 * Tracks the origin and reliability of beliefs and memories.
 * Inspired by AGI Memory's source attribution and trust computation.
 *
 * Key concepts:
 * - Every belief tracks its source(s)
 * - Trust levels computed from source reliability
 * - Multi-source aggregation
 * - Contradiction detection and resolution
 */

import type { Database } from 'better-sqlite3';

// =============================================================================
// Types
// =============================================================================

export type SourceKind =
  | 'stated' // User explicitly stated this
  | 'observed' // System observed behavior
  | 'inferred' // Derived from other beliefs
  | 'imported' // Imported from external source
  | 'conversation' // From conversation context;

export interface SourceRecord {
  id: string;
  kind: SourceKind;
  reference: string; // Conversation ID, event ID, etc.
  label: string; // Human-readable description
  observedAt: Date;
  trust: number; // 0.0-1.0 trust level for this source
  metadata?: Record<string, unknown>;
}

export interface Provenance {
  primarySource: SourceRecord;
  additionalSources: SourceRecord[];
  aggregatedTrust: number;
  contradictions: string[]; // IDs of contradicting beliefs
  lastValidated: Date;
  validationCount: number;
}

export interface TrustConfig {
  // Base trust levels by source kind
  baseTrust: Record<SourceKind, number>;
  // How much repeated observation increases trust
  observationBoost: number;
  // How much contradiction decreases trust
  contradictionPenalty: number;
  // Minimum trust before belief is considered unreliable
  minReliableTrust: number;
  // Trust decay rate per day without validation
  decayRatePerDay: number;
}

// Default trust configuration
export const DEFAULT_TRUST_CONFIG: TrustConfig = {
  baseTrust: {
    stated: 0.9, // User explicitly said it
    observed: 0.7, // We saw the behavior
    inferred: 0.5, // We derived it
    imported: 0.4, // External source
    conversation: 0.6, // Conversation context
  },
  observationBoost: 0.05,
  contradictionPenalty: 0.2,
  minReliableTrust: 0.3,
  decayRatePerDay: 0.01,
};

// =============================================================================
// Schema
// =============================================================================

const TRUST_SCHEMA = `
  -- Source records for provenance tracking
  CREATE TABLE IF NOT EXISTS source_records (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    reference TEXT NOT NULL,
    label TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    trust REAL NOT NULL DEFAULT 0.5,
    metadata_json TEXT DEFAULT '{}'
  );

  -- Link table: beliefs to sources (many-to-many)
  CREATE TABLE IF NOT EXISTS belief_sources (
    belief_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    is_primary INTEGER DEFAULT 0,
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (belief_id, source_id),
    FOREIGN KEY (source_id) REFERENCES source_records(id) ON DELETE CASCADE
  );

  -- Contradiction records
  CREATE TABLE IF NOT EXISTS belief_contradictions (
    id TEXT PRIMARY KEY,
    belief_id_1 TEXT NOT NULL,
    belief_id_2 TEXT NOT NULL,
    detected_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolution TEXT,
    resolved_at TEXT,
    metadata_json TEXT DEFAULT '{}'
  );

  -- Trust computation cache
  CREATE TABLE IF NOT EXISTS trust_cache (
    belief_id TEXT PRIMARY KEY,
    aggregated_trust REAL NOT NULL,
    source_count INTEGER NOT NULL,
    contradiction_count INTEGER NOT NULL,
    last_validated TEXT NOT NULL,
    validation_count INTEGER DEFAULT 1,
    computed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Indexes
  CREATE INDEX IF NOT EXISTS idx_belief_sources_belief ON belief_sources(belief_id);
  CREATE INDEX IF NOT EXISTS idx_belief_sources_source ON belief_sources(source_id);
  CREATE INDEX IF NOT EXISTS idx_contradictions_belief1 ON belief_contradictions(belief_id_1);
  CREATE INDEX IF NOT EXISTS idx_contradictions_belief2 ON belief_contradictions(belief_id_2);
`;

// =============================================================================
// Trust & Provenance Manager
// =============================================================================

export class TrustProvenanceManager {
  private config: TrustConfig;

  constructor(
    private db: Database,
    config?: Partial<TrustConfig>
  ) {
    this.config = { ...DEFAULT_TRUST_CONFIG, ...config };
  }

  /**
   * Initialize the trust schema
   */
  initialize(): void {
    this.db.exec(TRUST_SCHEMA);
  }

  // ---------------------------------------------------------------------------
  // Source Management
  // ---------------------------------------------------------------------------

  /**
   * Create a new source record
   */
  createSource(
    kind: SourceKind,
    reference: string,
    label: string,
    metadata?: Record<string, unknown>
  ): SourceRecord {
    const id = `src_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date();
    const trust = this.config.baseTrust[kind];

    this.db
      .prepare(
        `INSERT INTO source_records (id, kind, reference, label, observed_at, trust, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, kind, reference, label, now.toISOString(), trust, JSON.stringify(metadata || {}));

    return {
      id,
      kind,
      reference,
      label,
      observedAt: now,
      trust,
      metadata,
    };
  }

  /**
   * Get a source record by ID
   */
  getSource(id: string): SourceRecord | null {
    const row = this.db.prepare('SELECT * FROM source_records WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;

    if (!row) return null;

    return {
      id: row.id as string,
      kind: row.kind as SourceKind,
      reference: row.reference as string,
      label: row.label as string,
      observedAt: new Date(row.observed_at as string),
      trust: row.trust as number,
      metadata: JSON.parse((row.metadata_json as string) || '{}'),
    };
  }

  // ---------------------------------------------------------------------------
  // Belief-Source Linking
  // ---------------------------------------------------------------------------

  /**
   * Link a belief to a source
   */
  linkBeliefToSource(beliefId: string, sourceId: string, isPrimary = false): void {
    const now = new Date().toISOString();

    // If this is primary, un-primary any existing primary sources
    if (isPrimary) {
      this.db
        .prepare('UPDATE belief_sources SET is_primary = 0 WHERE belief_id = ?')
        .run(beliefId);
    }

    this.db
      .prepare(
        `INSERT OR REPLACE INTO belief_sources (belief_id, source_id, is_primary, added_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(beliefId, sourceId, isPrimary ? 1 : 0, now);

    // Invalidate trust cache
    this.invalidateTrustCache(beliefId);
  }

  /**
   * Create a source and link it to a belief in one operation
   */
  addSourceToBelief(
    beliefId: string,
    kind: SourceKind,
    reference: string,
    label: string,
    isPrimary = false,
    metadata?: Record<string, unknown>
  ): SourceRecord {
    const source = this.createSource(kind, reference, label, metadata);
    this.linkBeliefToSource(beliefId, source.id, isPrimary);
    return source;
  }

  /**
   * Get all sources for a belief
   */
  getBeliefSources(beliefId: string): {
    primary?: SourceRecord;
    additional: SourceRecord[];
  } {
    const rows = this.db
      .prepare(
        `SELECT sr.*, bs.is_primary
         FROM source_records sr
         JOIN belief_sources bs ON sr.id = bs.source_id
         WHERE bs.belief_id = ?
         ORDER BY bs.is_primary DESC, sr.observed_at DESC`
      )
      .all(beliefId) as Array<Record<string, unknown> & { is_primary: number }>;

    let primary: SourceRecord | undefined;
    const additional: SourceRecord[] = [];

    for (const row of rows) {
      const source: SourceRecord = {
        id: row.id as string,
        kind: row.kind as SourceKind,
        reference: row.reference as string,
        label: row.label as string,
        observedAt: new Date(row.observed_at as string),
        trust: row.trust as number,
        metadata: JSON.parse((row.metadata_json as string) || '{}'),
      };

      if (row.is_primary) {
        primary = source;
      } else {
        additional.push(source);
      }
    }

    return { primary, additional };
  }

  // ---------------------------------------------------------------------------
  // Trust Computation
  // ---------------------------------------------------------------------------

  /**
   * Compute aggregated trust for a belief
   */
  computeTrust(beliefId: string): number {
    const sources = this.getBeliefSources(beliefId);
    const contradictions = this.getContradictions(beliefId);

    if (!sources.primary && sources.additional.length === 0) {
      return 0.5; // Default trust if no sources
    }

    // Base trust from primary source
    let trust = sources.primary?.trust ?? 0.5;

    // Boost from additional sources (diminishing returns)
    for (let i = 0; i < sources.additional.length; i++) {
      const boost = this.config.observationBoost * Math.pow(0.5, i);
      trust = Math.min(1.0, trust + boost * sources.additional[i].trust);
    }

    // Penalty for contradictions
    trust -= contradictions.unresolved.length * this.config.contradictionPenalty;

    // Apply decay based on last validation
    const cached = this.getTrustCache(beliefId);
    if (cached) {
      const daysSinceValidation =
        (Date.now() - new Date(cached.lastValidated).getTime()) / (1000 * 60 * 60 * 24);
      trust -= daysSinceValidation * this.config.decayRatePerDay;
    }

    // Clamp to valid range
    trust = Math.max(0, Math.min(1, trust));

    // Update cache
    this.updateTrustCache(beliefId, trust, sources, contradictions);

    return trust;
  }

  /**
   * Get cached trust value (fast, may be stale)
   */
  getCachedTrust(beliefId: string): number | null {
    const row = this.db
      .prepare('SELECT aggregated_trust FROM trust_cache WHERE belief_id = ?')
      .get(beliefId) as { aggregated_trust: number } | undefined;

    return row?.aggregated_trust ?? null;
  }

  /**
   * Invalidate trust cache for a belief
   */
  private invalidateTrustCache(beliefId: string): void {
    this.db.prepare('DELETE FROM trust_cache WHERE belief_id = ?').run(beliefId);
  }

  /**
   * Get trust cache entry
   */
  private getTrustCache(
    beliefId: string
  ): {
    trust: number;
    lastValidated: string;
    validationCount: number;
  } | null {
    const row = this.db.prepare('SELECT * FROM trust_cache WHERE belief_id = ?').get(beliefId) as
      | Record<string, unknown>
      | undefined;

    if (!row) return null;

    return {
      trust: row.aggregated_trust as number,
      lastValidated: row.last_validated as string,
      validationCount: row.validation_count as number,
    };
  }

  /**
   * Update trust cache
   */
  private updateTrustCache(
    beliefId: string,
    trust: number,
    sources: { primary?: SourceRecord; additional: SourceRecord[] },
    contradictions: { resolved: unknown[]; unresolved: unknown[] }
  ): void {
    const now = new Date().toISOString();
    const sourceCount = (sources.primary ? 1 : 0) + sources.additional.length;

    this.db
      .prepare(
        `INSERT OR REPLACE INTO trust_cache
         (belief_id, aggregated_trust, source_count, contradiction_count, last_validated, validation_count, computed_at)
         VALUES (?, ?, ?, ?, ?, COALESCE((SELECT validation_count + 1 FROM trust_cache WHERE belief_id = ?), 1), ?)`
      )
      .run(
        beliefId,
        trust,
        sourceCount,
        contradictions.unresolved.length,
        now,
        beliefId,
        now
      );
  }

  // ---------------------------------------------------------------------------
  // Contradiction Management
  // ---------------------------------------------------------------------------

  /**
   * Record a contradiction between two beliefs
   */
  recordContradiction(
    beliefId1: string,
    beliefId2: string,
    metadata?: Record<string, unknown>
  ): string {
    const id = `contra_${Date.now()}`;
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO belief_contradictions (id, belief_id_1, belief_id_2, detected_at, metadata_json)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, beliefId1, beliefId2, now, JSON.stringify(metadata || {}));

    // Invalidate trust caches for both beliefs
    this.invalidateTrustCache(beliefId1);
    this.invalidateTrustCache(beliefId2);

    return id;
  }

  /**
   * Resolve a contradiction
   */
  resolveContradiction(
    contradictionId: string,
    resolution: 'keep_first' | 'keep_second' | 'keep_both' | 'invalidate_both'
  ): void {
    const now = new Date().toISOString();

    this.db
      .prepare('UPDATE belief_contradictions SET resolution = ?, resolved_at = ? WHERE id = ?')
      .run(resolution, now, contradictionId);

    // Get the affected beliefs and recompute trust
    const row = this.db
      .prepare('SELECT belief_id_1, belief_id_2 FROM belief_contradictions WHERE id = ?')
      .get(contradictionId) as { belief_id_1: string; belief_id_2: string } | undefined;

    if (row) {
      this.invalidateTrustCache(row.belief_id_1);
      this.invalidateTrustCache(row.belief_id_2);
    }
  }

  /**
   * Get contradictions for a belief
   */
  getContradictions(beliefId: string): {
    resolved: Array<{
      id: string;
      otherBeliefId: string;
      resolution: string;
      resolvedAt: string;
    }>;
    unresolved: Array<{ id: string; otherBeliefId: string; detectedAt: string }>;
  } {
    const rows = this.db
      .prepare(
        `SELECT * FROM belief_contradictions
         WHERE belief_id_1 = ? OR belief_id_2 = ?`
      )
      .all(beliefId, beliefId) as Array<Record<string, unknown>>;

    const resolved: Array<{
      id: string;
      otherBeliefId: string;
      resolution: string;
      resolvedAt: string;
    }> = [];
    const unresolved: Array<{ id: string; otherBeliefId: string; detectedAt: string }> = [];

    for (const row of rows) {
      const otherId =
        row.belief_id_1 === beliefId
          ? (row.belief_id_2 as string)
          : (row.belief_id_1 as string);

      if (row.resolution) {
        resolved.push({
          id: row.id as string,
          otherBeliefId: otherId,
          resolution: row.resolution as string,
          resolvedAt: row.resolved_at as string,
        });
      } else {
        unresolved.push({
          id: row.id as string,
          otherBeliefId: otherId,
          detectedAt: row.detected_at as string,
        });
      }
    }

    return { resolved, unresolved };
  }

  // ---------------------------------------------------------------------------
  // Provenance Retrieval
  // ---------------------------------------------------------------------------

  /**
   * Get full provenance for a belief
   */
  getProvenance(beliefId: string): Provenance | null {
    const sources = this.getBeliefSources(beliefId);
    const contradictions = this.getContradictions(beliefId);
    const cached = this.getTrustCache(beliefId);

    if (!sources.primary && sources.additional.length === 0) {
      return null;
    }

    const trust = cached?.trust ?? this.computeTrust(beliefId);

    return {
      primarySource: sources.primary || sources.additional[0],
      additionalSources: sources.primary ? sources.additional : sources.additional.slice(1),
      aggregatedTrust: trust,
      contradictions: contradictions.unresolved.map((c) => c.otherBeliefId),
      lastValidated: cached ? new Date(cached.lastValidated) : new Date(),
      validationCount: cached?.validationCount ?? 1,
    };
  }

  // ---------------------------------------------------------------------------
  // Batch Operations
  // ---------------------------------------------------------------------------

  /**
   * Recompute trust for all beliefs
   */
  recomputeAllTrust(): { updated: number; avgTrust: number } {
    // Get all beliefs with sources
    const beliefIds = this.db
      .prepare('SELECT DISTINCT belief_id FROM belief_sources')
      .all() as Array<{ belief_id: string }>;

    let totalTrust = 0;
    for (const row of beliefIds) {
      const trust = this.computeTrust(row.belief_id);
      totalTrust += trust;
    }

    return {
      updated: beliefIds.length,
      avgTrust: beliefIds.length > 0 ? totalTrust / beliefIds.length : 0,
    };
  }

  /**
   * Get beliefs below minimum reliable trust
   */
  getUnreliableBeliefs(): Array<{ beliefId: string; trust: number }> {
    const rows = this.db
      .prepare(
        `SELECT belief_id, aggregated_trust FROM trust_cache
         WHERE aggregated_trust < ?`
      )
      .all(this.config.minReliableTrust) as Array<{
      belief_id: string;
      aggregated_trust: number;
    }>;

    return rows.map((r) => ({ beliefId: r.belief_id, trust: r.aggregated_trust }));
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalSources: number;
    totalContradictions: { resolved: number; unresolved: number };
    avgTrust: number;
    trustDistribution: { high: number; medium: number; low: number };
  } {
    const sourceCount = (
      this.db.prepare('SELECT COUNT(*) as count FROM source_records').get() as { count: number }
    ).count;

    const resolvedCount = (
      this.db
        .prepare(
          'SELECT COUNT(*) as count FROM belief_contradictions WHERE resolution IS NOT NULL'
        )
        .get() as { count: number }
    ).count;

    const unresolvedCount = (
      this.db
        .prepare('SELECT COUNT(*) as count FROM belief_contradictions WHERE resolution IS NULL')
        .get() as { count: number }
    ).count;

    const avgTrust = (
      this.db
        .prepare('SELECT AVG(aggregated_trust) as avg FROM trust_cache')
        .get() as { avg: number | null }
    ).avg ?? 0;

    const highTrust = (
      this.db
        .prepare('SELECT COUNT(*) as count FROM trust_cache WHERE aggregated_trust >= 0.7')
        .get() as { count: number }
    ).count;

    const mediumTrust = (
      this.db
        .prepare(
          'SELECT COUNT(*) as count FROM trust_cache WHERE aggregated_trust >= 0.3 AND aggregated_trust < 0.7'
        )
        .get() as { count: number }
    ).count;

    const lowTrust = (
      this.db
        .prepare('SELECT COUNT(*) as count FROM trust_cache WHERE aggregated_trust < 0.3')
        .get() as { count: number }
    ).count;

    return {
      totalSources: sourceCount,
      totalContradictions: { resolved: resolvedCount, unresolved: unresolvedCount },
      avgTrust,
      trustDistribution: { high: highTrust, medium: mediumTrust, low: lowTrust },
    };
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createTrustProvenanceManager(
  db: Database,
  config?: Partial<TrustConfig>
): TrustProvenanceManager {
  const manager = new TrustProvenanceManager(db, config);
  manager.initialize();
  return manager;
}
