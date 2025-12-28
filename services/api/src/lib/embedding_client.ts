/**
 * Embedding Service Client
 *
 * Connects to the Python embedding server for real semantic embeddings.
 * This replaces MockEmbeddingProvider for production use.
 *
 * Usage:
 *   const client = new EmbeddingClient('http://localhost:8787');
 *   const embeddings = await client.embed(['Hello world', 'Goodbye world']);
 *   const results = await client.search('greeting', documents);
 */

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  embedSingle(text: string): Promise<number[]>;
  dimension: number;
}

export interface SimilarityResult {
  index: number;
  score: number;
  document: string;
}

export class EmbeddingClient implements EmbeddingProvider {
  private baseUrl: string;
  private _dimension: number = 384; // Default for all-MiniLM-L6-v2
  private initialized: boolean = false;

  constructor(baseUrl: string = 'http://localhost:8787') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  get dimension(): number {
    return this._dimension;
  }

  /**
   * Initialize and verify connection to embedding server
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      const response = await fetch(`${this.baseUrl}/health`);
      if (!response.ok) {
        throw new Error(`Embedding server health check failed: ${response.status}`);
      }
      const data = await response.json();
      this._dimension = data.dimension;
      this.initialized = true;
      console.log(`Connected to embedding server: ${data.model} (dim=${data.dimension})`);
    } catch (error) {
      throw new Error(`Cannot connect to embedding server at ${this.baseUrl}: ${error}`);
    }
  }

  /**
   * Embed multiple texts
   */
  async embed(texts: string[]): Promise<number[][]> {
    if (!this.initialized) await this.init();

    const response = await fetch(`${this.baseUrl}/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(`Embedding failed: ${error.error}`);
    }

    const data = await response.json();
    return data.embeddings;
  }

  /**
   * Embed a single text
   */
  async embedSingle(text: string): Promise<number[]> {
    const embeddings = await this.embed([text]);
    return embeddings[0];
  }

  /**
   * Search for similar documents
   */
  async search(query: string, documents: string[], topK: number = 10): Promise<SimilarityResult[]> {
    if (!this.initialized) await this.init();

    const response = await fetch(`${this.baseUrl}/similarity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, documents, top_k: topK }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(`Similarity search failed: ${error.error}`);
    }

    const data = await response.json();
    return data.results;
  }

  /**
   * Batch embed items with IDs (for storage)
   */
  async batchEmbed(items: Array<{ id: string; content: string }>): Promise<Record<string, number[]>> {
    if (!this.initialized) await this.init();

    const response = await fetch(`${this.baseUrl}/batch_similarity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(`Batch embedding failed: ${error.error}`);
    }

    const data = await response.json();
    return data.embeddings;
  }
}

/**
 * Factory function to create embedding provider
 * Falls back to mock if server unavailable
 */
export async function createEmbeddingProvider(
  serverUrl?: string,
  fallbackToMock: boolean = true
): Promise<EmbeddingProvider> {
  if (serverUrl) {
    try {
      const client = new EmbeddingClient(serverUrl);
      await client.init();
      return client;
    } catch (error) {
      if (!fallbackToMock) throw error;
      console.warn(`Embedding server unavailable, falling back to mock: ${error}`);
    }
  }

  // Import mock from vector_search
  const { MockEmbeddingProvider } = await import('./vector_search');
  return new MockEmbeddingProvider();
}
