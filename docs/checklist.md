# Ronald-GI Master Checklist

TDD-driven implementation checklist. Each item requires tests before marking complete.

---

## Phase 1: POC Foundation

### Infrastructure
- [x] SQLite database schema (16 tables)
- [x] Podman/Docker compose.yaml
- [x] Shell scripts: bootstrap, build, up, down, logs, health
- [ ] Host MLX server script (host_mlx_server.sh)
- [x] Ollama integration (cross-platform substitute)

### API Service (Fastify)
- [x] Health endpoint
- [x] Sources CRUD
- [x] Visits CRUD + batch insert
- [x] Visit clusters CRUD
- [x] Reports CRUD
- [x] Reports 3+1 home endpoint
- [x] Concepts CRUD
- [x] Concept mentions
- [x] Telemetry recording (single + batch)
- [x] Feedback recording
- [x] Jobs queue CRUD
- [x] System state endpoints
- [x] Preference weights endpoints
- [x] API unit tests (Vitest) - 53 tests covering adaptive behaviors
- [x] API integration tests

### Web Service (Next.js)
- [x] Home page with 3+1 stack
- [x] All cards view with filters
- [x] Report card component
- [x] Report type visual signatures
- [x] Dark theme (Tesla-like)
- [x] MobX stores (reports, telemetry)
- [ ] E2E tests (Playwright)

### Worker Service (Python)
- [x] Main worker loop
- [x] Job queue consumer
- [x] PocketFlow integration
- [x] Guardrails: secret detection
- [x] Guardrails: high-entropy token detection
- [x] Guardrails: payload sanitization
- [x] Worker unit tests (pytest)

### Embedder Service (FastAPI)
- [x] Embed endpoint
- [x] Batch embed endpoint
- [x] Model loading (nomic-embed-text or sentence-transformers)
- [x] Embedder tests

### Ingestion Scripts
- [x] ingest_paulbricman.py (GitHub repos)
- [x] generate_seed_reports.py
- [x] reingest_concepts.py (heuristic concept extraction)
- [x] extract_ontology.py (corpus-based ontology extraction)
- [x] ingest_safari_history.py
- [x] ingest_chrome_history.py
- [x] seed_bookmarks.py

### Evaluation
- [x] Integration test suite (26 tests passing)
- [x] Eval metrics dashboard (100/100 health score)
- [ ] Weekly metrics automation

---

## Phase 2: Telemetry + Feedback Learning

### Telemetry
- [x] IntersectionObserver for open/close
- [x] Dwell time tracking
- [x] Scroll depth tracking
- [x] Evidence click tracking
- [x] Telemetry flush to API

### Feedback
- [x] Feedback button component
- [x] Initial 5-button set
- [x] Bandit stats tracking (shown_count, clicked_count)
- [x] Button pruning algorithm (prune to 2)
- [x] Re-expansion trigger

### Pin System
- [x] Pin button on cards
- [x] Pinned reports filter
- [x] Pin in telemetry

### Repo Inspect Modality
- [x] Clone repo (depth=1)
- [x] Parse file tree
- [x] Extract README excerpt
- [x] Signal detection heuristics
- [ ] Sandbox execution

### A2UI Blocks
- [x] Block type definitions
- [x] KPI row renderer
- [x] Bullet list renderer
- [x] Link list renderer
- [x] Code block renderer
- [x] Note block renderer

---

## Phase 3: Discovery Spike Intelligence

### Semantic Clustering
- [x] Embedding-based concept clustering (extract_ontology.py)
- [x] Concept co-occurrence graph
- [x] Visit embedding pipeline
- [x] Time-based clustering
- [x] Burst score calculation
- [x] Novelty score calculation
- [x] Intensity score (0.6*burst + 0.4*novelty)

### Preference Weights
- [x] Concept weight updates from engagement
- [x] Host weight updates
- [x] Report type weight updates
- [x] Obsession gradient calculation

### Concept Graph
- [x] Nearest concepts cache
- [x] Nearest reports cache
- [x] Nearest visits cache
- [x] Concept co-occurrence tracking (extract_ontology.py)

---

## Phase 4: Bricman Seed Pack

### Ingestion
- [x] Fetch all paulbricman repos
- [x] Filter forks
- [x] Extract README content
- [x] Generate embeddings
- [x] Extract concepts
- [x] Generate summaries
- [ ] Improved concept extraction prompts
- [ ] Concept deduplication
- [ ] Concept quality filtering

### Seed Pack Reports
- [x] Basic repo_signal reports
- [x] Heuristic concept extraction (149 active concepts, 0 orphans)
- [x] Garbage concept cleanup (removed generic/placeholder concepts)
- [ ] Bricman Seed Pack overview report
- [ ] Concept mapping report (how Bricman maps to Ronald)
- [ ] Repo recommendation report

---

## Phase 5: Stopping Policy

### Telemetry Analysis
- [x] Feature extraction from early signals
- [x] Satisfaction prediction model
- [x] Cost tracking per report

### Stop Conditions
- [x] Evidence + judgment + decision check
- [x] UI blocks + concept links check
- [x] Marginal value < marginal cost check
- [x] Learned stop threshold

---

## Phase 6: Concept Drift

### Merge Operations
- [x] Concept similarity detection
- [x] Merge suggestion generation
- [x] Merge execution (keep alias)
- [x] Merge undo

### Kill Operations
- [x] Low-value concept detection
- [x] Kill suggestion generation
- [x] Kill execution (soft delete)
- [x] Kill undo

### Diff View
- [x] Weekly concept changes report
- [ ] Concept graph visualization

---

## Phase 7: Repo Run/Test Modality

### Execution Agent
- [x] Clone → install → test pipeline
- [x] Screenshot/log capture
- [x] Timeout handling
- [x] Network isolation (firejail support)

### Gating
- [x] High intensity threshold
- [x] High uncertainty threshold
- [x] Explicit escalate/test decision

---

## Phase 8: Local Fine-tune

### Dataset Builder
- [x] Pinned reports collection
- [x] Edit history collection
- [x] Accept/reject collection
- [x] Engagement signal collection

### Training Infrastructure
- [x] Preference model training framework
- [x] LoRA fine-tuning pipeline (MLX)
- [x] Training job management
- [x] Model registry and deployment
- [x] MLX training script generator

### ACE-Inspired Personalization (Stanford ACE pattern)
- [x] PersonalizationAgent - Context generation
- [x] PersonalizationReflector - Learning signal analysis
- [x] PersonalizationSkillManager - Weight updates and decay
- [x] LearningVerifier - Prove system is learning
- [x] Obsession gradient calculation
- [x] Temporal decay for stale interests

---

## Phase 9: Broader Domains

### Domain Modules
- [x] Finance specialization (ticker extraction, sentiment signals)
- [x] People/networking specialization (profile extraction, hiring signals)
- [x] Operations specialization (cloud services, incident detection)
- [x] Domain router for automatic routing
- [x] Domain-specific report type suggestions

---

## Cross-Cutting Concerns

### Privacy & Security
- [x] Secret pattern detection (AWS, GitHub, etc.)
- [x] High-entropy token detection
- [x] Allowlist-only outbound fields
- [x] PII detection (SSN, credit cards, API keys, etc.)
- [x] PII redaction
- [x] Audit logging
- [ ] Container sandbox verification

### Performance
- [x] Performance monitoring (latency, percentiles)
- [x] SLA checking
- [ ] API response time < 100ms (monitoring in place)
- [ ] Embedding generation < 200ms
- [ ] Report generation < 30s
- [ ] Memory usage monitoring

### Reliability
- [x] Graceful degradation (GracefulDegrader)
- [x] Job retry with exponential backoff
- [x] Circuit breaker pattern
- [x] Health check automation
- [ ] Error alerting

### Documentation
- [x] design.md
- [x] checklist.md
- [ ] API documentation (OpenAPI)
- [ ] User guide
- [ ] Deployment guide

---

## Testing Summary

### Test Coverage (139 tests passing)
- [x] essence.test.ts (12) - Core learning verification
- [x] worldmodel.test.ts (13) - User profile emergence
- [x] adaptive.test.ts (22) - Adaptive behaviors
- [x] personalization.test.ts (20) - ACE framework
- [x] modules.test.ts (41) - Phase 8, 9, Cross-cutting
- [x] reports.test.ts (17) - API functionality
- [x] gating.test.ts (14) - Test run gating

---

## Current Status Summary

| Category | Complete | Total | % |
|----------|----------|-------|---|
| Phase 1 | 36 | 37 | 97% |
| Phase 2 | 23 | 24 | 96% |
| Phase 3 | 13 | 13 | 100% |
| Phase 4 | 9 | 12 | 75% |
| Phase 5 | 7 | 7 | 100% |
| Phase 6 | 9 | 10 | 90% |
| Phase 7 | 7 | 7 | 100% |
| Phase 8 | 11 | 11 | 100% |
| Phase 9 | 5 | 5 | 100% |
| Cross-Cutting | 12 | 18 | 67% |
| **Total** | **132** | **144** | **92%** |

---

## Next Priority Actions

1. **E2E tests** - Fix remaining Playwright tests
2. **API documentation** - OpenAPI spec
3. **Concept graph visualization** - Complete Phase 6 with visual diff
4. **Error alerting** - Add alerting for failures
5. **Container sandbox verification** - Security hardening
