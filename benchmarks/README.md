# Ronald-GI Benchmark Suite

## Purpose

Validate that the Ronald-GI memory system provides **measurable value** over baseline approaches.

## Benchmark Categories

### 1. Economic Viability (`cost_analysis.ts`)
- Storage costs per user over time
- Query latency overhead
- Embedding computation costs
- Comparison with cloud alternatives (Pinecone, Weaviate)

### 2. Persona Consistency (`persona_test.ts`)
- Inject a character biography
- Add unrelated noise data
- Test if "mind" responds as persona
- Measure persona drift over time

### 3. Memory Retrieval (`memory_bench.ts`)
- Precision/Recall at various thresholds
- Query latency distribution
- Scalability with dataset size
- Comparison: RAG vs simple keyword search

### 4. Long-term Conversation (`locomo_bench.ts`)
- Based on LoCoMo benchmark
- Single-hop retrieval
- Multi-hop reasoning
- Temporal reasoning
- Open-domain questions

## Reference Benchmarks

| Benchmark | Paper | What it Tests |
|-----------|-------|---------------|
| [LoCoMo](https://arxiv.org/abs/2402.17753) | ACL 2024 | Long-term conversational memory |
| [PersonaMem](https://arxiv.org/abs/2504.14225) | 2025 | Dynamic user profiling |
| [MemoryBench](https://arxiv.org/abs/2510.17281) | 2025 | Memory and continual learning |
| [Evo-Memory](https://arxiv.org/abs/2511.20857) | 2025 | Test-time memory evolution |

## Running Benchmarks

```bash
# Run all benchmarks
npm run benchmark

# Run specific benchmark
npm run benchmark:persona
npm run benchmark:memory
npm run benchmark:cost
npm run benchmark:locomo
```

## Expected Outcomes

### Success Criteria
1. **Cost**: <$0.01/user/month for local storage
2. **Latency**: <50ms overhead for memory operations
3. **Persona**: >80% consistency after 1000 noise injections
4. **Retrieval**: >90% precision@5 for exact matches

### Failure Modes
- High false positive rate in retrieval
- Persona confusion after noise
- Unacceptable latency at scale
- Storage costs exceeding cloud alternatives
