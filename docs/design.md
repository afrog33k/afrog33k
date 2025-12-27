# Ronald-GI POC v1 Design Note

A local-first, autonomous, colleague-style "digital mind" that reduces cognitive burden via continuous research, concept modeling, and decision compression.

---

## 0. Goal and non-goals

### Goal

Build Software Dev Ronald-GI v1: a local-first system that:
- continuously ingests what you actually do (Safari/Chrome history, bookmarks, GitHub links, arXiv)
- autonomously chooses what to research next (ideation) under budget
- produces frequent reports ("cards") with judgment + evidence + decision suggestions
- learns alignment primarily from implicit engagement telemetry + minimal explicit feedback
- evolves its own policies over time (stopping criteria, ranking, UI feedback set, concept drift)
- stays private: no secrets/keys/passwords leave the machine

### Non-goals (v1)
- AGI, general "life assistant for everyone"
- fully offline web browsing (obviously)
- production-grade multi-device CRDT sync (tailnet canonical instance is enough for v1)
- containerized MLX (Metal isn't in containers)

---

## 1. Core UX contract

### Home = 3 + 1 Stack
- **Top 3**: blended score = high Decision Impact + Novelty, small relevance component
- **+1**: the best Relevance pick (current obsession gradient)

### All Cards View
Browse everything, filter/sort by:
- newest / blended / pinned / type
- promoted / not promoted
- search text

### Report types (semantic meaning + visual signature)
1. **Decision Memo** — "do this / kill that"
2. **Research Brief** — "here's the model + citations"
3. **Repo Signal** — "I inspected it; here's what's real"
4. **Concept Drift** — "merge/kill/relabel concepts"
5. **Watchlist Alert** — "new thing near your frontier"

### Tone
- colleague voice, direct, calm, judgment-forward
- never "boss" language

---

## 2. System architecture (v1)

### Runtime split
- **Host (macOS)**: MLX inference server (Qwen3 Thinking), localhost only
- **Podman containers**: everything else (web/api/worker/embedder/tailscale)

### Services
1. **web** (Next.js, Tailwind, MobX)
2. **api** (Fastify + SQLite)
3. **agent-worker** (Python, PocketFlow orchestration, Playwright browsing, repo inspect, synthesis)
4. **embedder** (FastAPI + sentence-transformers embeddings)
5. **tailscale** (optional; or tailnet the host)

### Storage
- SQLite as system-of-record:
  - reports, telemetry, sources, visits, clusters, concepts, weights, cached neighbors
- No SQLite graph/vector extensions required for v1. Worker computes vector/graph operations and caches results in tables.

### "Everything through scripts"
- `scripts/bootstrap.sh` `build.sh` `up.sh` `down.sh` `logs.sh` `health.sh`
- `scripts/host_mlx_server.sh` (host)
- `scripts/ingest_history.sh` (Safari/Chrome)
- `scripts/seed_bookmarks.sh`
- `scripts/ingest_paulbricman_repos.sh` (later phase)

---

## 3. Data model (v1 tables)

### Sources / inputs
- **sources** (bookmarks + explicit links)
- **visits** (Safari/Chrome history)
- **visit_clusters** (time + semantic clusters; "discovery spikes")
- **docs** (optional, for repo READMEs / extracted article text)

### Outputs
- **reports** (including scores, uiBlocksJson, pinned, promoted)
- **telemetry** (open/close/dwell/scroll/click/pin)
- **feedback** (explicit actions pressed)

### Learning / control planes
- **ui_action_stats** (bandit stats, enabled actions)
- **preference_weights** (concept/host/type weights)
- **concepts** + **concept_mentions** (your evolving concept map)
- **caches**:
  - nearest_concepts, nearest_reports, nearest_visits (precomputed top-k)

---

## 4. Guardrails and privacy model (non-negotiable)

### Hard (deterministic) guard
Secret scanner at every outbound boundary:
- common key patterns + high-entropy token detection
- allowlist-only outbound payload fields

### Soft (NER) guard
PII detection/anonymization (Presidio/GLiNER later; v1 can start with minimal heuristics)

### Execution safety
- repo clone/inspect runs in worker container sandbox
- no secrets mounted into containers
- MLX server binds 127.0.0.1 only
- worker container talks to host MLX via host.containers.internal only

---

## 5. Core algorithmic loops

### 5.1 Ingestion loop

**Inputs:**
- Safari/Chrome history export (time lineage)
- bookmarks/links (seed)
- later: full GitHub org ingestion (Bricman)

**Processing:**
- store raw events → build clusters → embed → detect spikes → create candidates

### 5.2 Ideation loop (what to research next)

**Candidate sources:**
- unprocessed visit clusters (your discovery spikes)
- sources backlog (bookmarks)
- frontier mining (DDG queries around your current concept neighborhoods)
- contradiction/tension triggers (later)

**Candidate scoring:**
- Impact (I): expected decision compression / loop closure
- Novelty (N): distance vs your existing concept/embedding baseline
- Relevance (R): fit to current obsession gradient (derived from engagement)
- Cost (C): estimated compute/time/tools
- Uncertainty (U): confidence gaps, conflicting evidence

**Selection:**
```
maximize: 0.45*I + 0.45*N + 0.10*R - λ*C + μ*U
```
Always keep a +1 relevance slot for obsession alignment.

### 5.3 Research modality selection

**Modality escalation ladder:**
1. concept recall (internal)
2. direct visits from spike (extract)
3. DDG browse + extract + cite
4. repo inspect (GitHub) in sandbox
5. repo run/test (later, gated)

**Stop condition ("good enough"):**
- rule-based in v1; learned later from telemetry:
  - has evidence + judgment + decision + next action
  - has UI blocks and concept links
  - marginal value < marginal cost for another step

### 5.4 Report synthesis loop
- worker creates a structured report via MLX:
  - strict JSON output (type, findings, decision, scores, uiBlocks)
- store report + scores + ui blocks
- decide promoted vs stream

### 5.5 Feedback + telemetry loop

**Implicit telemetry (primary):**
- open/close/dwell via IntersectionObserver
- scroll depth
- evidence clicks
- pins

**Explicit feedback (secondary):**
- buttons, dynamically pruned:
  - start with 5, prune to 2 via bandit
  - expand back to 5 when repeated rejection signals occur

### 5.6 Evolution loop (meta-agent behavior)

**Triggers:**
- stagnation (novelty down, spend constant)
- ADHD spiral (branching up, closures down)
- misalignment (dwell/pin drop)
- contradictions (concept drift incoherence)
- budget inefficiency

**Actions:**
- adjust ideation weights
- change modality thresholds
- change report formatting complexity
- update button set
- generate concept drift report (merge/kill candidates)

---

## 6. "Discovery spikes" modeling (Safari/Chrome lineage)

### What gets stored
- raw visits (url/title/browser/visitedAt/host)
- clusters with:
  - startedAt/endedAt
  - urlsJson (top 60 links)
  - statsJson: host, count, semantic=true
- spike metrics:
  - burst (density vs baseline)
  - novelty (how new host/topic is vs history)
  - intensity = 0.6*burst + 0.4*novelty

### Why this matters
This is the most honest proxy for "what you were genuinely exploring," and becomes the best seed for autonomous ideation.

---

## 7. Embeddings strategy (v1)
- embedder service (container) for:
  - visit embeddings
  - concept label embeddings
  - report embeddings (optional)
- similarity and clustering done in worker; results cached in SQLite tables
- no vector extensions required

---

## 8. PocketFlow usage (v1)

PocketFlow orchestrates all agent behavior via explicit flows:

### Flows
- **IdeationFlow**: choose candidate (weighted by spike intensity + preference_weights)
- **VisitExtractFlow**: visit top URLs from a spike, extract, summarize
- **DdgResearchFlow**: DDG browse, extract, cite
- **RepoInspectFlow**: clone depth=1, parse tree + readme excerpt, detect signals
- **SynthesisFlow**: call MLX to generate strict JSON report w/ uiBlocks
- **WriteFlow**: write report to SQLite, mark processed
- **MetaFlow**: update feedback actions + preference weights + concept drift jobs

---

## 9. Visual design system (Tesla-like)

### Principles
- calm dark background, minimal chrome
- cards have clear "shape" by report type
- consistent typography, whitespace, and motion
- never show "everything" by default
- home always stays 3+1

### A2UI-ish blocks
- KPI rows, bullets, links, notes, code blocks
- later: diagrams (SVG), generated images, small charts

---

## 10. Deployment and access (tailnet)

### v1 sync strategy
- one canonical instance on tailnet
- all devices access over Tailscale
- avoids CRDT complexity early

### Later sync upgrade
- CR-SQLite or similar for multi-primary offline merge (future)

---

## 11. Evaluation plan (progressive, measurable)

### Primary success metric
- You keep using it daily (usage is eval)

### Operational metrics (computed weekly)
- open rate of promoted reports
- median dwell time
- pin rate
- "kill_thread" ratio
- closure rate: reports that produce decisions vs endless "defer"
- novelty distribution
- cost/value: $ per pinned report, $ per adopted decision

### Phase gates
Move to next phase only when:
- engagement improves or stays stable
- cognitive burden subjectively decreases
- budget stays under control

---

## 12. Phases to build v1 and beyond

### Phase 1 — POC foundation
**Deliverables:**
- Podman compose + scripts
- host MLX server script
- API + web basic
- ingest bookmarks + history
- basic worker loop producing reports
- 3+1 home, all cards view
- basic guardrails

**Exit criteria:**
- system runs reliably on tailnet
- it produces at least 10 reports without manual babysitting

### Phase 2 — Telemetry + feedback learning
**Deliverables:**
- IntersectionObserver open/close telemetry
- bandit-pruned feedback buttons
- pinned reports
- repo inspect modality
- A2UI blocks render

**Exit criteria:**
- button set prunes itself
- relevance improves over 1–2 weeks (more dwell/pin)

### Phase 3 — Discovery spike intelligence
**Deliverables:**
- semantic clustering using embedder
- spike intensity metrics
- preference weights driven ideation
- concept nodes + mentions + nearest caches

**Exit criteria:**
- spikes → meaningful reports; you feel "it noticed what I was exploring"
- obsession gradient starts to appear naturally

### Phase 4 — Bricman ingestion + "seed pack"
**Deliverables:**
- scripts/ingest_paulbricman_repos.sh
- enumerate all repos under paulbricman
- ingest README/docs into docs table
- create concept nodes + metrics extracted
- generate "Bricman Seed Pack" concept drift report

**Exit criteria:**
- system can explain how Bricman primitives map into your architecture
- it can autonomously recommend which Bricman repos matter

### Phase 5 — Stopping policy v1 (learned "good enough")
**Deliverables:**
- learned stop model using telemetry
- reduces overspending by stopping earlier when outcome is clear

**Exit criteria:**
- lower average cost per accepted report without reducing satisfaction

### Phase 6 — Concept drift with reversible merges/kills
**Deliverables:**
- concept merge suggestions w/ evidence
- reversible operations (merge A → B, kill C)
- "diff view" reports: what changed in your mental model this week

**Exit criteria:**
- concept map becomes cleaner over time
- fewer duplicate concepts

### Phase 7 — Repo run/test modality (sandbox)
**Deliverables:**
- gated execution agent
- strict network/secret policies

**Exit criteria:**
- you trust repo claims more because it actually executed

### Phase 8 — Local fine-tune / preference model
**Deliverables:**
- dataset builder from pinned reports + edits
- train small preference model or LoRA

**Exit criteria:**
- higher first-pass alignment

### Phase 9 — Broader domains
**Deliverables:**
- additional specializations (finance, people, operations)
- same concept substrate, different "world modules"

**Exit criteria:**
- your work becomes mostly "decisions"

---

## 13. What "v1 complete" means

v1 is done when:
- you open it daily and it reduces mental load
- it produces frequent high-signal reports without you prompting
- you trust its judgments enough to defer worrying
- it learns your obsession gradient and surfaces the right things
- privacy guardrails are robust and boring

---

## 14. Advanced Cognitive Modeling (Added 2024-12-27)

Based on 2025 arxiv research, Ronald-GI now includes:

### 14.1 BDI User Modeling (Satori Pattern)

Based on arxiv:2410.16668, models user mental state:

- **Beliefs**: What user thinks is true (expertise, interests, preferences)
- **Desires**: What user wants (goals, aspirations, needs)
- **Intentions**: What user plans to do (tasks, projects, habits)

Key capability: Infer needs from gaps between desires and intentions.

**Implementation**: `services/api/src/lib/bdi_model.ts`

### 14.2 Attention State Inference (ADHD-Aware)

Based on arxiv:2507.06864, detects cognitive states:

- **Focused**: Deep work, low switching, high completion
- **Scattered**: High switching, partial engagement
- **Hyperfocus**: Very long single-task dwell (ADHD characteristic)
- **Crashed**: Low activity, high switching, no completion

Key capability: Context-aware nudges based on attention state.

**Implementation**: `services/api/src/lib/attention_inference.ts`

### 14.3 Evaluation Framework

Answers: "Is this system actually useful?"

- **Ground Truth Collection**: User feedback on predictions
- **Metric Calculation**: Accuracy, effectiveness, learning rate
- **A/B Testing**: Statistical significance testing
- **Health Reports**: Verdicts with recommendations

**Implementation**: `services/api/src/lib/eval_framework.ts`

### 14.4 Self-Evolution Loop (Pending)

Based on EvolveR (arxiv:2510.16079) and ALAS (arxiv:2508.15805):

```
Experience Storage → Distillation → Model Update → Measure → Repeat
```

**Status**: Architecture designed, implementation pending.

### 14.5 Platform Detection

Auto-detects platform and selects optimal inference backend:

- macOS Apple Silicon → MLX
- macOS Intel / Linux → Ollama
- Windows → Ollama or API

**Implementation**: `services/api/src/lib/platform.ts`
