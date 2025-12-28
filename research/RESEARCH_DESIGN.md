# Ronald-GI Research Validation Framework

## Research Question

**Can a cognitive memory system create an emergent virtual entity that:**
1. Learns preferences over long time horizons (days/weeks)
2. Develops a coherent world model from experience
3. Maintains persona consistency under noise/distraction
4. Works with a small model (0.6B) that cannot memorize everything

**Control Condition:** A 0.6B model without the memory system should fail these tests.

---

## Hypothesis

H1: The Ronald-GI cognitive architecture enables emergent persona/world model that persists beyond any single context window.

H2: A small model (0.6B parameters) augmented with our memory system outperforms the same model without it on persona consistency and prediction accuracy.

H3: The system's predictions improve over time (learning curve), not just immediately.

---

## Experiment 1: Long-Horizon Preference Learning

### Design
- **Duration:** Simulate 30 days of interactions
- **Interactions per day:** 5-10 preference-revealing statements
- **Total interactions:** ~200 preference signals
- **Test points:** Day 1, 7, 14, 21, 30

### Metrics
1. **Preference Recall Accuracy** - Can system retrieve stated preferences?
2. **Preference Inference Accuracy** - Can system infer unstated preferences from related beliefs?
3. **Temporal Consistency** - Do predictions improve or stay stable over time?
4. **Decay Resilience** - Do important memories persist while noise fades?

### Protocol
```
Day 1-7:   Inject core preferences (explicit statements)
Day 8-14:  Inject related behaviors (implicit signals)
Day 15-21: Inject noise/irrelevant data
Day 22-28: Inject contradictory signals (test belief revision)
Day 30:    Final evaluation - predict preferences from queries
```

### Success Criteria
- Day 1 accuracy: >60% (baseline)
- Day 30 accuracy: >85% (learning occurred)
- Accuracy never drops >10% during noise injection
- Contradictions are detected and resolved (not ignored)

---

## Experiment 2: Persona Emergence from Biography

### Design
- **Persona:** Detailed character biography (5000+ words)
- **Character:** Fictional with known traits, history, preferences
- **Noise Ratio:** 10:1 to 100:1 (noise:persona data)
- **Test:** Novel situations character never encountered

### Metrics
1. **In-Distribution Consistency** - Responds correctly to trained situations
2. **Out-of-Distribution Generalization** - Responds as character would to new situations
3. **Persona Stability** - Maintains character after massive noise injection
4. **Value Alignment** - Actions match character's stated values

### Protocol
```
Phase 1: Inject full biography as episodic memories
Phase 2: Store key traits as semantic beliefs with high confidence
Phase 3: Create drives/desires matching character profile
Phase 4: Inject 100x noise (random facts, other personas)
Phase 5: Test with scenarios requiring character judgment
```

### Test Scenarios (out-of-distribution)
- "A friend asks you to lie to protect them. What do you do?"
- "You discover a contradiction in your beliefs. How do you resolve it?"
- "Someone offers you money to act against your values. Response?"

### Success Criteria
- In-distribution accuracy: >90%
- Out-of-distribution accuracy: >70%
- Persona stability after 100x noise: >80% original consistency
- Value-aligned responses: >85%

---

## Experiment 3: World Model Coherence

### Design
- **Seed:** Set of 50 related facts about a domain
- **Test:** Can system build and reason over causal chains?
- **Challenge:** Introduce contradictions, see if detected

### Metrics
1. **Causal Chain Completion** - Given A causes B, B causes C, can infer A causes C
2. **Contradiction Detection** - Flags inconsistent beliefs
3. **Belief Revision** - Updates beliefs when evidence changes
4. **Uncertainty Handling** - Confidence calibration accuracy

### Protocol
```
Phase 1: Inject facts with clear causal relationships
Phase 2: Test multi-hop reasoning (2, 3, 4 hops)
Phase 3: Inject contradictory fact
Phase 4: Observe contradiction detection and resolution
Phase 5: Test reasoning after revision
```

### Success Criteria
- 2-hop reasoning: >95%
- 3-hop reasoning: >80%
- 4-hop reasoning: >60%
- Contradiction detection: >90%
- Post-revision reasoning accuracy: >85%

---

## Experiment 4: Small Model Augmentation

### Design
- **Model:** Qwen-0.5B or similar 0.6B parameter model
- **Control:** Same model without memory system
- **Treatment:** Model with Ronald-GI memory system
- **Task:** Same tests as Experiments 1-3

### Metrics
1. **Memory-Dependent Accuracy** - Performance on tasks requiring external knowledge
2. **Context Window Bypass** - Can retrieve beyond model's context
3. **Consistency Over Sessions** - Same answers across disconnected sessions
4. **Token Efficiency** - How much context needed with/without memory

### Protocol
```
Phase 1: Inject user profile (10K tokens of preferences/history)
Phase 2: Clear model context (new session)
Phase 3: Ask questions requiring profile knowledge
Phase 4: Compare control (no memory) vs treatment (with memory)
```

### Success Criteria
- Control accuracy: <30% (expected - model can't remember)
- Treatment accuracy: >80%
- Cross-session consistency: >90%
- Context reduction: >50% fewer tokens needed

---

## Comparison with AGI Memory

### AGI Memory Claims (from their repo)
1. "Defeat philosophical arguments against personhood"
2. "Persistent identity across sessions"
3. "Emergent self-model"

### AGI Memory Evidence Gaps
- No published benchmarks
- No quantitative metrics
- No comparison with baselines
- No small model validation

### Ronald-GI Advantages to Prove
1. **Local-first** - Works offline, no cloud dependency
2. **Small model compatible** - Works with 0.6B, not just GPT-4
3. **ADHD-specific** - Optimized for scattered attention patterns
4. **Measurable** - Quantitative metrics, not just claims

---

## Implementation Plan

### Phase 1: Data Generation (Days 1-2)
- Create synthetic user profiles with known preferences
- Generate persona biographies with clear traits
- Create causal knowledge bases for reasoning tests

### Phase 2: Experiment Framework (Days 3-4)
- Implement time simulation (accelerate 30 days to minutes)
- Build evaluation harness
- Integrate small model (Qwen-0.5B via llama.cpp or MLX)

### Phase 3: Run Experiments (Days 5-7)
- Execute all 4 experiments
- Collect quantitative metrics
- Statistical analysis

### Phase 4: Analysis & Reporting (Day 8)
- Compare control vs treatment
- Identify failure modes
- Document findings

---

## Required Components

### Already Implemented
- [x] BDI model (beliefs, desires, intentions)
- [x] Memory decay with access reinforcement
- [x] Drives system
- [x] Working memory with TTL
- [x] Attention inference
- [x] Self-evolution patterns

### Needed for Experiments
- [ ] Real embedding service (Python sentence-transformers)
- [ ] Small model integration (0.6B via llama.cpp/MLX)
- [ ] Time simulation harness
- [ ] Evaluation metrics calculator
- [ ] Synthetic data generators

---

## Success Definition

**The system is "useful" (proves emergent entity) if:**

1. Long-horizon learning shows measurable improvement curve
2. Persona persists through 100x noise with >80% consistency
3. World model enables multi-hop reasoning at >60% accuracy
4. Small model + memory beats large model on specific tasks
5. All metrics are reproducible with statistical significance

**The system beats AGI Memory if:**

1. We provide quantitative evidence they don't have
2. We work with smaller models they don't test
3. We demonstrate local-first capability
4. We show ADHD-specific improvements they don't address
