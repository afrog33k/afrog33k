# Changelog

All notable changes to Ronald-GI will be documented in this file.

## [0.2.0] - 2025-12-28 - LLM Deep Research Engine

### Added

#### LLM Deep Research Engine (`src/core/llm_deep_research.ts`)
- **Tongyi-style Architecture**: Workspace reconstruction with question + evolving synthesis + last context
- **ReAct Loop**: Think → Act → Observe → Synthesize cycle for iterative research
- **Self-Reflection Mechanism**: Error-reflection loop (Step-DeepResearch pattern) with up to 3 retries
- **Cross-Validation**: Multi-source claim verification to boost confidence
- **Parallel Exploration**: Multi-agent concurrent research via `researchParallel()` method
- **Authority-Aware Ranking**: 25+ curated authoritative domains with scoring (MDN: 1.0, arXiv: 0.95, GitHub: 0.8, etc.)

#### LLM Providers
- `OllamaLLMProvider`: Local Ollama support with qwen3 thinking field handling
- `OpenRouterLLMProvider`: Cloud LLM support (free tier available)
- `AnthropicLLMProvider`: Claude API support
- `SmartRuleBasedProvider`: Intelligent fallback without LLM API

#### Research Benchmark Suite (`src/core/research_benchmark.ts`)
- **RACE Metrics**: Relevance, Accuracy, Completeness, Engagement scoring
- **FACT Metrics**: Citation count, accuracy, diversity, authority scoring
- **10 Benchmark Tasks**: Across 4 difficulty levels (easy, medium, hard, phd-level)
- **Category Support**: technology, science, business, general
- **Comparison with SOTA**: Gemini Deep Research benchmark comparison

#### Workflow Detector (`src/core/workflow_detector.ts`)
- **Action Tokenization**: Convert user actions to comparable patterns
- **Pattern Detection**: Find recurring action sequences (min 3 occurrences)
- **Automation Suggestions**: Proactive suggestions with confidence building
- **Test Run Framework**: Validate workflows before automation (5 runs required)
- **Destructive Action Blocking**: Refuses to automate delete, deploy to prod, etc.
- **Progressive Trust**: "I ran 5 tests at 90% accuracy" messaging

#### Test Suite (`src/__tests__/llm_deep_research.test.ts`)
- 18 comprehensive tests covering all core functionality
- Mock ResearchAdapter for isolated testing
- Tests for: SmartRuleBasedProvider, Authority Ranking, Self-Reflection, Query Simplification, Cross-Validation, Full Research Flow, Confidence Estimation, Config Defaults

### Changed

#### Research Adapter (`src/core/research_adapter.ts`)
- Switched from DuckDuckGo (CAPTCHA blocked) to HN Algolia + Wikipedia fallback
- Added keyword extraction for better search results
- Improved GitHub repository search

#### Living Core (`src/core/living_core.ts`)
- Enhanced `doDeepResearch` to persist all artifacts (synthesis, recommendations, concepts, beliefs)
- Updated rabbit_holes schema with synthesis, curiosity_score, settled_score, confidence, recommendations columns

### Performance

| System | RACE | FACT | Citations | Time/Task |
|--------|------|------|-----------|-----------|
| Gemini 2.5 Deep Research | 84.7% | ~90% | 111 | N/A |
| Ronald-GI (Rule-Based) | 49.3% | 0%* | 6 | 3s |
| Ronald-GI (Ollama qwen3:0.6b) | 56%+ | TBD | 3+ | ~160s |

*FACT 0% because rule-based provider doesn't verify citations

### Known Issues
- DuckDuckGo blocks datacenter IPs with CAPTCHA
- Ollama qwen3:4b OOMs on 8GB RAM (use qwen3:0.6b instead)
- Ollama qwen3 models output to `thinking` field, not `response`

---

## [0.1.0] - 2025-12-27 - Foundation

### Added
- Initial Living Core with heartbeat-based processing
- Cognitive model for beliefs and concepts
- Rule-based deep research
- SQLite persistence layer
- Basic research adapter with arXiv support
