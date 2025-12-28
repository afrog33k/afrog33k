/**
 * Vector Search Layer
 *
 * Provides semantic similarity search with multiple backends:
 * 1. sqlite-vec extension (production, if available)
 * 2. In-memory brute force with cosine similarity (fallback)
 * 3. Python embedding service (for production deployments)
 *
 * Inspired by: AGI Memory's embedding architecture
 */

import type { Database } from 'better-sqlite3';

// =============================================================================
// Types
// =============================================================================

export interface VectorRecord {
  id: string;
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface SearchResult {
  id: string;
  content: string;
  similarity: number;
  metadata: Record<string, unknown>;
}

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  dimension: number;
}

export type VectorBackend = 'sqlite-vec' | 'brute-force' | 'hybrid';

export interface VectorSearchConfig {
  backend: VectorBackend;
  dimension: number;
  embeddingProvider?: EmbeddingProvider;
  tableName?: string;
}

// =============================================================================
// Schema
// =============================================================================

const VECTOR_SCHEMA_BRUTE_FORCE = `
  -- Vector storage for brute-force search
  CREATE TABLE IF NOT EXISTS vector_embeddings (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    embedding_blob BLOB NOT NULL,
    dimension INTEGER NOT NULL,
    metadata_json TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_vector_embeddings_created
    ON vector_embeddings(created_at DESC);
`;

// sqlite-vec uses virtual tables - we'll create these if extension is available
const VECTOR_SCHEMA_SQLITE_VEC = (tableName: string, dimension: number) => `
  -- sqlite-vec virtual table (requires extension)
  CREATE VIRTUAL TABLE IF NOT EXISTS ${tableName}_vec USING vec0(
    id TEXT PRIMARY KEY,
    embedding float[${dimension}]
  );

  -- Metadata table linked to vector table
  CREATE TABLE IF NOT EXISTS ${tableName}_meta (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    metadata_json TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

// =============================================================================
// Cosine Similarity (for brute-force)
// =============================================================================

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

function vectorToBlob(vector: number[]): Buffer {
  const buffer = Buffer.alloc(vector.length * 4);
  for (let i = 0; i < vector.length; i++) {
    buffer.writeFloatLE(vector[i], i * 4);
  }
  return buffer;
}

function blobToVector(blob: Buffer): number[] {
  const vector: number[] = [];
  for (let i = 0; i < blob.length; i += 4) {
    vector.push(blob.readFloatLE(i));
  }
  return vector;
}

// =============================================================================
// Vector Search Class
// =============================================================================

export class VectorSearch {
  private backend: VectorBackend;
  private dimension: number;
  private tableName: string;
  private embeddingProvider?: EmbeddingProvider;
  private sqliteVecAvailable = false;

  constructor(
    private db: Database,
    config: VectorSearchConfig
  ) {
    this.backend = config.backend;
    this.dimension = config.dimension;
    this.tableName = config.tableName || 'vectors';
    this.embeddingProvider = config.embeddingProvider;
  }

  /**
   * Initialize the vector search schema
   */
  async initialize(): Promise<void> {
    // Check if sqlite-vec is available
    if (this.backend === 'sqlite-vec' || this.backend === 'hybrid') {
      this.sqliteVecAvailable = await this.checkSqliteVec();
    }

    if (this.sqliteVecAvailable) {
      try {
        this.db.exec(VECTOR_SCHEMA_SQLITE_VEC(this.tableName, this.dimension));
      } catch {
        // Fall back to brute force if virtual table creation fails
        this.sqliteVecAvailable = false;
      }
    }

    // Always create brute-force tables as fallback
    this.db.exec(VECTOR_SCHEMA_BRUTE_FORCE);
  }

  /**
   * Check if sqlite-vec extension is available
   */
  private async checkSqliteVec(): Promise<boolean> {
    try {
      // Try to load the extension
      // This would need the actual sqlite-vec.so/.dylib/.dll
      // For now, we'll assume it's not available
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Store a vector
   */
  async store(
    id: string,
    content: string,
    embedding?: number[],
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    // Get embedding if not provided
    let vector = embedding;
    if (!vector) {
      if (!this.embeddingProvider) {
        throw new Error('No embedding provided and no embedding provider configured');
      }
      vector = await this.embeddingProvider.embed(content);
    }

    if (vector.length !== this.dimension) {
      throw new Error(
        `Embedding dimension mismatch: expected ${this.dimension}, got ${vector.length}`
      );
    }

    const now = new Date().toISOString();

    if (this.sqliteVecAvailable) {
      // Store in sqlite-vec virtual table
      this.db
        .prepare(
          `INSERT OR REPLACE INTO ${this.tableName}_vec (id, embedding) VALUES (?, ?)`
        )
        .run(id, JSON.stringify(vector));

      this.db
        .prepare(
          `INSERT OR REPLACE INTO ${this.tableName}_meta (id, content, metadata_json, created_at)
           VALUES (?, ?, ?, ?)`
        )
        .run(id, content, JSON.stringify(metadata), now);
    } else {
      // Store in brute-force table
      const blob = vectorToBlob(vector);
      this.db
        .prepare(
          `INSERT OR REPLACE INTO vector_embeddings
           (id, content, embedding_blob, dimension, metadata_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(id, content, blob, this.dimension, JSON.stringify(metadata), now, now);
    }
  }

  /**
   * Store multiple vectors in batch
   */
  async storeBatch(
    records: Array<{
      id: string;
      content: string;
      embedding?: number[];
      metadata?: Record<string, unknown>;
    }>
  ): Promise<void> {
    // Get embeddings for records that don't have them
    const needsEmbedding = records.filter((r) => !r.embedding);
    let embeddings: number[][] = [];

    if (needsEmbedding.length > 0 && this.embeddingProvider) {
      embeddings = await this.embeddingProvider.embedBatch(
        needsEmbedding.map((r) => r.content)
      );
    }

    let embeddingIndex = 0;
    const transaction = this.db.transaction(() => {
      for (const record of records) {
        const embedding = record.embedding || embeddings[embeddingIndex++];
        if (!embedding) {
          throw new Error(`No embedding for record ${record.id}`);
        }

        // Use synchronous version for transaction
        this.storeSync(record.id, record.content, embedding, record.metadata || {});
      }
    });

    transaction();
  }

  /**
   * Synchronous store (for transactions)
   */
  private storeSync(
    id: string,
    content: string,
    embedding: number[],
    metadata: Record<string, unknown>
  ): void {
    const now = new Date().toISOString();
    const blob = vectorToBlob(embedding);

    this.db
      .prepare(
        `INSERT OR REPLACE INTO vector_embeddings
         (id, content, embedding_blob, dimension, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, content, blob, this.dimension, JSON.stringify(metadata), now, now);
  }

  /**
   * Search for similar vectors
   */
  async search(
    query: string | number[],
    limit = 10,
    minSimilarity = 0.0
  ): Promise<SearchResult[]> {
    // Get query embedding
    let queryVector: number[];
    if (typeof query === 'string') {
      if (!this.embeddingProvider) {
        throw new Error('String query provided but no embedding provider configured');
      }
      queryVector = await this.embeddingProvider.embed(query);
    } else {
      queryVector = query;
    }

    if (this.sqliteVecAvailable) {
      return this.searchSqliteVec(queryVector, limit, minSimilarity);
    } else {
      return this.searchBruteForce(queryVector, limit, minSimilarity);
    }
  }

  /**
   * Search using sqlite-vec
   */
  private searchSqliteVec(
    queryVector: number[],
    limit: number,
    minSimilarity: number
  ): SearchResult[] {
    // sqlite-vec uses k-NN search
    const rows = this.db
      .prepare(
        `SELECT v.id, v.distance, m.content, m.metadata_json
         FROM ${this.tableName}_vec v
         JOIN ${this.tableName}_meta m ON v.id = m.id
         WHERE v.embedding MATCH ?
         ORDER BY v.distance
         LIMIT ?`
      )
      .all(JSON.stringify(queryVector), limit) as Array<{
      id: string;
      distance: number;
      content: string;
      metadata_json: string;
    }>;

    return rows
      .map((row) => ({
        id: row.id,
        content: row.content,
        similarity: 1 - row.distance, // Convert distance to similarity
        metadata: JSON.parse(row.metadata_json),
      }))
      .filter((r) => r.similarity >= minSimilarity);
  }

  /**
   * Search using brute-force cosine similarity
   */
  private searchBruteForce(
    queryVector: number[],
    limit: number,
    minSimilarity: number
  ): SearchResult[] {
    // Get all vectors (inefficient but works for small datasets)
    const rows = this.db
      .prepare('SELECT id, content, embedding_blob, metadata_json FROM vector_embeddings')
      .all() as Array<{
      id: string;
      content: string;
      embedding_blob: Buffer;
      metadata_json: string;
    }>;

    // Calculate similarities
    const results: SearchResult[] = rows
      .map((row) => {
        const embedding = blobToVector(row.embedding_blob);
        const similarity = cosineSimilarity(queryVector, embedding);
        return {
          id: row.id,
          content: row.content,
          similarity,
          metadata: JSON.parse(row.metadata_json),
        };
      })
      .filter((r) => r.similarity >= minSimilarity)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return results;
  }

  /**
   * Delete a vector
   */
  delete(id: string): boolean {
    if (this.sqliteVecAvailable) {
      this.db.prepare(`DELETE FROM ${this.tableName}_vec WHERE id = ?`).run(id);
      this.db.prepare(`DELETE FROM ${this.tableName}_meta WHERE id = ?`).run(id);
    }

    const result = this.db
      .prepare('DELETE FROM vector_embeddings WHERE id = ?')
      .run(id);

    return result.changes > 0;
  }

  /**
   * Get a vector by ID
   */
  get(id: string): VectorRecord | null {
    const row = this.db
      .prepare(
        'SELECT id, content, embedding_blob, metadata_json, created_at FROM vector_embeddings WHERE id = ?'
      )
      .get(id) as
      | {
          id: string;
          content: string;
          embedding_blob: Buffer;
          metadata_json: string;
          created_at: string;
        }
      | undefined;

    if (!row) return null;

    return {
      id: row.id,
      content: row.content,
      embedding: blobToVector(row.embedding_blob),
      metadata: JSON.parse(row.metadata_json),
      createdAt: row.created_at,
    };
  }

  /**
   * Get statistics
   */
  getStats(): {
    count: number;
    dimension: number;
    backend: string;
    sqliteVecAvailable: boolean;
  } {
    const count = (
      this.db.prepare('SELECT COUNT(*) as count FROM vector_embeddings').get() as {
        count: number;
      }
    ).count;

    return {
      count,
      dimension: this.dimension,
      backend: this.sqliteVecAvailable ? 'sqlite-vec' : 'brute-force',
      sqliteVecAvailable: this.sqliteVecAvailable,
    };
  }
}

// =============================================================================
// Mock Embedding Provider (for testing)
// =============================================================================

export class MockEmbeddingProvider implements EmbeddingProvider {
  dimension = 384;

  async embed(text: string): Promise<number[]> {
    // Simple hash-based mock embedding
    const hash = this.hashString(text);
    return this.hashToVector(hash, this.dimension);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  private hashToVector(hash: number, dim: number): number[] {
    const vector: number[] = [];
    let seed = hash;
    for (let i = 0; i < dim; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      vector.push((seed / 0x7fffffff) * 2 - 1);
    }
    // Normalize
    const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
    return vector.map((v) => v / norm);
  }
}

// =============================================================================
// ONNX Embedding Provider (optional, requires onnxruntime-node)
// =============================================================================

export class ONNXEmbeddingProvider implements EmbeddingProvider {
  dimension = 384;
  private _session: unknown = null;
  private _modelPath: string;

  constructor(modelPath: string) {
    this._modelPath = modelPath;
  }

  async initialize(): Promise<void> {
    // Dynamic import to avoid requiring onnxruntime-node at load time
    try {
      const ort = await import('onnxruntime-node');
      this._session = await ort.InferenceSession.create(this._modelPath);
    } catch (e) {
      console.warn('ONNX runtime not available, using mock embeddings');
    }
  }

  async embed(text: string): Promise<number[]> {
    if (!this._session) {
      // Fallback to mock
      return new MockEmbeddingProvider().embed(text);
    }

    // This is a simplified example - real implementation would need tokenization
    throw new Error('ONNX embedding not fully implemented - use Python service');
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}

// =============================================================================
// Factory
// =============================================================================

export async function createVectorSearch(
  db: Database,
  config: Partial<VectorSearchConfig> = {}
): Promise<VectorSearch> {
  const fullConfig: VectorSearchConfig = {
    backend: config.backend || 'hybrid',
    dimension: config.dimension || 384,
    embeddingProvider: config.embeddingProvider || new MockEmbeddingProvider(),
    tableName: config.tableName || 'vectors',
  };

  const vectorSearch = new VectorSearch(db, fullConfig);
  await vectorSearch.initialize();
  return vectorSearch;
}
