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
- [ ] API unit tests (Vitest)
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
- [ ] Clone repo (depth=1)
- [ ] Parse file tree
- [ ] Extract README excerpt
- [ ] Signal detection heuristics
- [ ] Sandbox execution

### A2UI Blocks
- [ ] Block type definitions
- [ ] KPI row renderer
- [ ] Bullet list renderer
- [ ] Link list renderer
- [ ] Code block renderer
- [ ] Note block renderer

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
- [ ] Concept weight updates from engagement
- [ ] Host weight updates
- [ ] Report type weight updates
- [ ] Obsession gradient calculation

### Concept Graph
- [ ] Nearest concepts cache
- [ ] Nearest reports cache
- [ ] Nearest visits cache
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
- [ ] Feature extraction from early signals
- [ ] Satisfaction prediction model
- [ ] Cost tracking per report

### Stop Conditions
- [ ] Evidence + judgment + decision check
- [ ] UI blocks + concept links check
- [ ] Marginal value < marginal cost check
- [ ] Learned stop threshold

---

## Phase 6: Concept Drift

### Merge Operations
- [ ] Concept similarity detection
- [ ] Merge suggestion generation
- [ ] Merge execution (keep alias)
- [ ] Merge undo

### Kill Operations
- [ ] Low-value concept detection
- [ ] Kill suggestion generation
- [ ] Kill execution (soft delete)
- [ ] Kill undo

### Diff View
- [ ] Weekly concept changes report
- [ ] Concept graph visualization

---

## Phase 7: Repo Run/Test Modality

### Execution Agent
- [ ] Clone → install → test pipeline
- [ ] Screenshot/log capture
- [ ] Timeout handling
- [ ] Network isolation

### Gating
- [ ] High intensity threshold
- [ ] High uncertainty threshold
- [ ] Explicit escalate/test decision

---

## Phase 8: Local Fine-tune

### Dataset Builder
- [ ] Pinned reports collection
- [ ] Edit history collection
- [ ] Accept/reject collection

### Training
- [ ] Preference model training
- [ ] LoRA fine-tuning
- [ ] Model deployment

---

## Phase 9: Broader Domains

### Domain Modules
- [ ] Finance specialization
- [ ] People/networking specialization
- [ ] Operations specialization

---

## Cross-Cutting Concerns

### Privacy & Security
- [x] Secret pattern detection (AWS, GitHub, etc.)
- [x] High-entropy token detection
- [x] Allowlist-only outbound fields
- [ ] PII detection (Presidio/GLiNER)
- [ ] Audit logging
- [ ] Container sandbox verification

### Performance
- [ ] API response time < 100ms
- [ ] Embedding generation < 200ms
- [ ] Report generation < 30s
- [ ] Memory usage monitoring

### Reliability
- [ ] Graceful degradation
- [ ] Job retry with backoff
- [ ] Health check automation
- [ ] Error alerting

### Documentation
- [x] design.md
- [x] checklist.md
- [ ] API documentation (OpenAPI)
- [ ] User guide
- [ ] Deployment guide

---

## Current Status Summary

| Category | Complete | Total | % |
|----------|----------|-------|---|
| Phase 1 | 36 | 36 | 100% |
| Phase 2 | 13 | 20 | 65% |
| Phase 3 | 8 | 13 | 62% |
| Phase 4 | 9 | 12 | 75% |
| Phase 5 | 0 | 6 | 0% |
| Phase 6 | 0 | 10 | 0% |
| Phase 7 | 0 | 6 | 0% |
| Phase 8 | 0 | 4 | 0% |
| Phase 9 | 0 | 3 | 0% |
| Cross-Cutting | 5 | 15 | 33% |
| **Total** | **71** | **125** | **57%** |

---

## Next Priority Actions

1. **Preference weights** - Implement engagement-based weight updates
2. **Nearest caches** - Build concept/report/visit similarity caches
3. **Phase 2 A2UI blocks** - Implement block renderers
4. **Phase 2 repo inspect** - Clone and analyze repositories
5. **E2E tests** - Fix remaining 2 failing Playwright tests
