# Changelog

All notable changes to Ronald-GI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Self-Evolution Loop** (`services/api/src/lib/self_evolution.ts`)
  - ExperienceStore: Record predictions and actual outcomes
  - PatternDistiller: Discover temporal, contextual, behavioral patterns
  - RuleUpdater: Create/update/deprecate rules from patterns
  - EvolutionMeasurer: Track accuracy and improvement over time
  - CurriculumManager: Adaptive learning phases (exploration → consolidation → refinement)
  - SelfEvolutionLoop: Full orchestration with prediction and feedback
  - 32 comprehensive tests in `self_evolution.test.ts`
  - Based on EvolveR (arxiv:2510.16079) and ALAS (arxiv:2508.15805)

- **BDI User Modeling System** (`services/api/src/lib/bdi_model.ts`)
  - BeliefManager: Track user expertise, interests, preferences, context
  - DesireManager: Model user goals, aspirations, needs
  - IntentionManager: Track tasks, projects, habits with lifecycle
  - BDIReasoner: Infer user needs from gaps between desires and intentions
  - ADHD-specific: Scattered attention detection, cognitive load monitoring
  - 39 comprehensive tests in `bdi_model.test.ts`

- **Attention State Inference** (`services/api/src/lib/attention_inference.ts`)
  - AttentionAnalyzer: Detect focused, scattered, hyperfocus, crashed states
  - Activity type classification (coding, research, communication, etc.)
  - Cognitive load estimation from tab count, switching frequency
  - NudgeManager: Context-aware interventions with cooldowns
  - DopBoostSystem: Gamification with streaks and achievements
  - 39 tests in `attention_inference.test.ts`

- **Evaluation Framework** (`services/api/src/lib/eval_framework.ts`)
  - GroundTruthCollector: Collect user feedback on predictions
  - MetricCalculator: Prediction accuracy, intervention effectiveness, learning rate
  - ABTestFramework: A/B testing with statistical significance
  - EvalReportGenerator: System health reports with verdicts
  - 30 tests in `eval_framework.test.ts`

- **User Profile Seeding** (`scripts/seed_user_profile.py`)
  - Seeds BDI model with user data from public sources
  - Creates beliefs, desires, intentions, skills, work history

- **Platform Detection & MLX Support** (`services/api/src/lib/platform.ts`)
  - Auto-detect macOS/Linux/Windows
  - MLX availability detection for Apple Silicon
  - Model selection based on platform capabilities

- **Test Infrastructure Enhancements** (`services/api/src/__tests__/setup.ts`)
  - BDI model test tables and helpers
  - Attention inference test tables and helpers
  - Eval framework test tables
  - Activity simulation helpers (focused, scattered, crashed, hyperfocus)

### Changed
- Enhanced test suite now covers 289/298 tests passing (97.0%)

### Research Papers Referenced
- Satori (arxiv:2410.16668): BDI user modeling
- ADHD-Aware AI Framework (arxiv:2507.06864): Attention state inference
- EvolveR (arxiv:2510.16079): Self-evolving agents
- ALAS (arxiv:2508.15805): Autonomous learning
- Mem0 (GitHub mem0ai/mem0): Memory layer architecture

## [0.1.0] - 2024-12-27

### Added
- Initial Ronald-GI POC implementation
- Memory layer with hybrid storage
- Anticipation engine for proactive assistance
- Alerting system
- Personalization framework
- World model building and testing
- Core API service with SQLite backend
- Web frontend with Next.js
- Basic ingestion scripts (HackerNews, Twitter, Reading List)
