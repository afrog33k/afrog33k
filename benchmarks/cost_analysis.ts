/**
 * Economic Viability Analysis
 *
 * Compares Ronald-GI's local-first approach with cloud alternatives.
 * Measures actual costs for storage, computation, and operations.
 */

import Database from 'better-sqlite3';
import { statSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// =============================================================================
// Cost Models
// =============================================================================

interface CloudCosts {
  pinecone: {
    storagePerMillion: number; // $/month per million vectors
    queryPer1000: number; // $ per 1000 queries
  };
  weaviate: {
    storagePerGB: number; // $/month per GB
    queryPer1000: number;
  };
  openaiEmbeddings: {
    per1000Tokens: number;
  };
}

const CLOUD_COSTS: CloudCosts = {
  pinecone: {
    storagePerMillion: 0.33, // Starter plan ~$0.33/M vectors/month
    queryPer1000: 0.00008, // $8 per 100k queries
  },
  weaviate: {
    storagePerGB: 0.25, // Serverless ~$0.25/GB/month
    queryPer1000: 0.0004, // ~$0.40/1000 queries
  },
  openaiEmbeddings: {
    per1000Tokens: 0.00002, // text-embedding-3-small
  },
};

interface LocalCosts {
  storagePerGB: number; // Assumed SSD cost amortized
  embeddingPerVector: number; // Local ONNX/MLX cost (electricity)
  queryLatencyMs: number;
}

const LOCAL_COSTS: LocalCosts = {
  storagePerGB: 0.001, // Negligible for local SSD
  embeddingPerVector: 0.000001, // ~$0.001/1000 embeddings (electricity)
  queryLatencyMs: 5, // Target query latency
};

// =============================================================================
// Usage Scenarios
// =============================================================================

interface UsageScenario {
  name: string;
  dailyConversations: number;
  avgMessagesPerConversation: number;
  avgTokensPerMessage: number;
  queriesPerConversation: number;
  vectorDimension: number;
  retentionDays: number;
}

const SCENARIOS: UsageScenario[] = [
  {
    name: 'Light User',
    dailyConversations: 2,
    avgMessagesPerConversation: 10,
    avgTokensPerMessage: 50,
    queriesPerConversation: 3,
    vectorDimension: 384,
    retentionDays: 90,
  },
  {
    name: 'Regular User',
    dailyConversations: 5,
    avgMessagesPerConversation: 20,
    avgTokensPerMessage: 75,
    queriesPerConversation: 5,
    vectorDimension: 384,
    retentionDays: 365,
  },
  {
    name: 'Power User',
    dailyConversations: 15,
    avgMessagesPerConversation: 30,
    avgTokensPerMessage: 100,
    queriesPerConversation: 10,
    vectorDimension: 384,
    retentionDays: 730,
  },
  {
    name: 'Enterprise User',
    dailyConversations: 50,
    avgMessagesPerConversation: 50,
    avgTokensPerMessage: 150,
    queriesPerConversation: 20,
    vectorDimension: 384,
    retentionDays: 1095,
  },
];

// =============================================================================
// Cost Calculation Functions
// =============================================================================

interface CostBreakdown {
  scenario: string;
  monthly: {
    local: {
      storage: number;
      embedding: number;
      total: number;
    };
    pinecone: {
      storage: number;
      queries: number;
      embedding: number;
      total: number;
    };
    weaviate: {
      storage: number;
      queries: number;
      embedding: number;
      total: number;
    };
  };
  yearly: {
    local: number;
    pinecone: number;
    weaviate: number;
  };
  savings: {
    vsPinecone: number;
    vsWeaviate: number;
    percentVsPinecone: number;
    percentVsWeaviate: number;
  };
}

function calculateCosts(scenario: UsageScenario): CostBreakdown {
  // Monthly calculations
  const monthlyMessages =
    scenario.dailyConversations *
    scenario.avgMessagesPerConversation *
    30;
  const monthlyTokens = monthlyMessages * scenario.avgTokensPerMessage;
  const monthlyQueries =
    scenario.dailyConversations *
    scenario.queriesPerConversation *
    30;

  // Total vectors over retention period
  const totalVectors =
    monthlyMessages *
    (scenario.retentionDays / 30);

  // Storage size estimate: each vector is dimension * 4 bytes (float32) + metadata ~500 bytes
  const bytesPerVector = scenario.vectorDimension * 4 + 500;
  const totalStorageGB = (totalVectors * bytesPerVector) / (1024 * 1024 * 1024);

  // Local costs
  const localStorage = totalStorageGB * LOCAL_COSTS.storagePerGB;
  const localEmbedding = monthlyMessages * LOCAL_COSTS.embeddingPerVector;
  const localTotal = localStorage + localEmbedding;

  // Pinecone costs
  const pineconeStorage = (totalVectors / 1_000_000) * CLOUD_COSTS.pinecone.storagePerMillion;
  const pineconeQueries = (monthlyQueries / 1000) * CLOUD_COSTS.pinecone.queryPer1000;
  const pineconeEmbedding =
    (monthlyTokens / 1000) * CLOUD_COSTS.openaiEmbeddings.per1000Tokens;
  const pineconeTotal = pineconeStorage + pineconeQueries + pineconeEmbedding;

  // Weaviate costs
  const weaviateStorage = totalStorageGB * CLOUD_COSTS.weaviate.storagePerGB;
  const weaviateQueries = (monthlyQueries / 1000) * CLOUD_COSTS.weaviate.queryPer1000;
  const weaviateEmbedding =
    (monthlyTokens / 1000) * CLOUD_COSTS.openaiEmbeddings.per1000Tokens;
  const weaviateTotal = weaviateStorage + weaviateQueries + weaviateEmbedding;

  return {
    scenario: scenario.name,
    monthly: {
      local: {
        storage: localStorage,
        embedding: localEmbedding,
        total: localTotal,
      },
      pinecone: {
        storage: pineconeStorage,
        queries: pineconeQueries,
        embedding: pineconeEmbedding,
        total: pineconeTotal,
      },
      weaviate: {
        storage: weaviateStorage,
        queries: weaviateQueries,
        embedding: weaviateEmbedding,
        total: weaviateTotal,
      },
    },
    yearly: {
      local: localTotal * 12,
      pinecone: pineconeTotal * 12,
      weaviate: weaviateTotal * 12,
    },
    savings: {
      vsPinecone: pineconeTotal * 12 - localTotal * 12,
      vsWeaviate: weaviateTotal * 12 - localTotal * 12,
      percentVsPinecone:
        pineconeTotal > 0 ? ((pineconeTotal - localTotal) / pineconeTotal) * 100 : 0,
      percentVsWeaviate:
        weaviateTotal > 0 ? ((weaviateTotal - localTotal) / weaviateTotal) * 100 : 0,
    },
  };
}

// =============================================================================
// Performance Benchmarks
// =============================================================================

interface PerformanceMetrics {
  insertLatencyMs: {
    min: number;
    max: number;
    avg: number;
    p95: number;
  };
  queryLatencyMs: {
    min: number;
    max: number;
    avg: number;
    p95: number;
  };
  dbSizeKB: number;
  recordCount: number;
}

function measurePerformance(recordCount: number): PerformanceMetrics {
  const dbPath = join(tmpdir(), `ronald_gi_bench_${Date.now()}.db`);
  const db = new Database(dbPath);

  // Create schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS test_vectors (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      embedding BLOB NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_created ON test_vectors(created_at DESC);
  `);

  const insertLatencies: number[] = [];
  const queryLatencies: number[] = [];

  // Insert records
  const insertStmt = db.prepare(
    'INSERT INTO test_vectors (id, content, embedding, created_at) VALUES (?, ?, ?, ?)'
  );
  const now = new Date().toISOString();

  for (let i = 0; i < recordCount; i++) {
    const embedding = Buffer.alloc(384 * 4);
    for (let j = 0; j < 384; j++) {
      embedding.writeFloatLE(Math.random(), j * 4);
    }

    const start = performance.now();
    insertStmt.run(`id_${i}`, `Content for record ${i} with some additional text`, embedding, now);
    insertLatencies.push(performance.now() - start);
  }

  // Query records
  const queryStmt = db.prepare(
    'SELECT * FROM test_vectors ORDER BY created_at DESC LIMIT 10'
  );

  for (let i = 0; i < 100; i++) {
    const start = performance.now();
    queryStmt.all();
    queryLatencies.push(performance.now() - start);
  }

  // Get DB size
  db.close();
  const dbSize = statSync(dbPath).size / 1024;

  // Cleanup
  if (existsSync(dbPath)) {
    unlinkSync(dbPath);
  }

  const percentile = (arr: number[], p: number) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.floor(sorted.length * p);
    return sorted[idx];
  };

  return {
    insertLatencyMs: {
      min: Math.min(...insertLatencies),
      max: Math.max(...insertLatencies),
      avg: insertLatencies.reduce((a, b) => a + b, 0) / insertLatencies.length,
      p95: percentile(insertLatencies, 0.95),
    },
    queryLatencyMs: {
      min: Math.min(...queryLatencies),
      max: Math.max(...queryLatencies),
      avg: queryLatencies.reduce((a, b) => a + b, 0) / queryLatencies.length,
      p95: percentile(queryLatencies, 0.95),
    },
    dbSizeKB: dbSize,
    recordCount,
  };
}

// =============================================================================
// Main Analysis
// =============================================================================

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('              ECONOMIC VIABILITY ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════');

  // Cost Analysis
  console.log('\n📊 COST COMPARISON (Monthly)\n');
  console.log('Scenario         | Local    | Pinecone | Weaviate | Savings vs Cloud');
  console.log('-----------------|----------|----------|----------|------------------');

  const costResults: CostBreakdown[] = [];
  for (const scenario of SCENARIOS) {
    const costs = calculateCosts(scenario);
    costResults.push(costs);

    console.log(
      `${scenario.name.padEnd(16)} | ` +
        `$${costs.monthly.local.total.toFixed(4).padStart(7)} | ` +
        `$${costs.monthly.pinecone.total.toFixed(2).padStart(7)} | ` +
        `$${costs.monthly.weaviate.total.toFixed(2).padStart(7)} | ` +
        `${costs.savings.percentVsPinecone.toFixed(0)}% / ${costs.savings.percentVsWeaviate.toFixed(0)}%`
    );
  }

  // Yearly costs
  console.log('\n📊 YEARLY COST COMPARISON\n');
  console.log('Scenario         | Local/yr | Pinecone/yr | Weaviate/yr | Annual Savings');
  console.log('-----------------|----------|-------------|-------------|---------------');

  for (const costs of costResults) {
    console.log(
      `${costs.scenario.padEnd(16)} | ` +
        `$${costs.yearly.local.toFixed(2).padStart(7)} | ` +
        `$${costs.yearly.pinecone.toFixed(2).padStart(10)} | ` +
        `$${costs.yearly.weaviate.toFixed(2).padStart(10)} | ` +
        `$${costs.savings.vsPinecone.toFixed(2)}`
    );
  }

  // Performance benchmarks
  console.log('\n⚡ PERFORMANCE BENCHMARKS\n');

  const recordCounts = [1000, 10000, 50000];
  for (const count of recordCounts) {
    console.log(`\nTesting with ${count.toLocaleString()} records...`);
    const perf = measurePerformance(count);

    console.log(`  DB Size: ${(perf.dbSizeKB / 1024).toFixed(2)} MB`);
    console.log(
      `  Insert Latency: avg=${perf.insertLatencyMs.avg.toFixed(2)}ms, p95=${perf.insertLatencyMs.p95.toFixed(2)}ms`
    );
    console.log(
      `  Query Latency:  avg=${perf.queryLatencyMs.avg.toFixed(2)}ms, p95=${perf.queryLatencyMs.p95.toFixed(2)}ms`
    );
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                         SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');

  const avgSavings =
    costResults.reduce((sum, c) => sum + c.savings.percentVsPinecone, 0) /
    costResults.length;

  console.log(`\n✅ Average cost savings vs cloud: ${avgSavings.toFixed(0)}%`);
  console.log('✅ Local-first means no network latency for queries');
  console.log('✅ Data stays on user device (privacy)');
  console.log('✅ No vendor lock-in');
  console.log(
    '\n⚠️  Trade-offs:'
  );
  console.log('   - No cloud sync without additional infrastructure');
  console.log('   - Embedding computation uses local CPU/GPU');
  console.log('   - Backup is user responsibility');

  // Verdict
  console.log('\n' + '═'.repeat(65));
  const verdict = avgSavings > 90;
  console.log(verdict ? '✅ ECONOMICALLY VIABLE' : '❌ RECONSIDER APPROACH');
  console.log(
    `Local-first approach provides ${avgSavings.toFixed(0)}% cost savings on average.`
  );

  return costResults;
}

// Export for use in test framework
export { calculateCosts, measurePerformance, SCENARIOS, CLOUD_COSTS };

// Run benchmark
main().catch(console.error);
