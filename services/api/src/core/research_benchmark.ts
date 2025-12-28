/**
 * Deep Research Benchmark Suite
 *
 * Based on DeepResearch Bench (arxiv:2506.11763):
 * - RACE metrics: Report quality evaluation
 * - FACT metrics: Citation accuracy verification
 *
 * Evaluates research agent performance against PhD-level research tasks
 */

import {
  LLMDeepResearch,
  ResearchReport,
  LLMProvider,
  SmartRuleBasedProvider,
  OllamaLLMProvider,
  Citation,
} from './llm_deep_research';

// ============================================================================
// BENCHMARK TYPES
// ============================================================================

export interface BenchmarkTask {
  id: string;
  category: 'technology' | 'science' | 'business' | 'general';
  difficulty: 'easy' | 'medium' | 'hard' | 'phd-level';
  question: string;
  expectedTopics: string[];      // Key topics that should be covered
  expectedSources: string[];     // Types of sources expected (e.g., 'github', 'arxiv')
  groundTruth?: string;          // Optional ground truth answer for comparison
}

export interface RACEMetrics {
  // Report quality metrics
  relevance: number;             // 0-1: Does report address the question?
  accuracy: number;              // 0-1: Are facts correct?
  completeness: number;          // 0-1: Are all aspects covered?
  engagement: number;            // 0-1: Is it well-written and engaging?
  overall: number;               // Weighted average
}

export interface FACTMetrics {
  // Citation accuracy metrics
  citationCount: number;         // Total citations
  verifiedCitations: number;     // Citations that were verified
  citationAccuracy: number;      // 0-1: verifiedCitations / citationCount
  sourceDiversity: number;       // 0-1: Variety of source types
  authorityScore: number;        // 0-1: Average authority of sources
}

export interface BenchmarkResult {
  task: BenchmarkTask;
  report: ResearchReport;
  race: RACEMetrics;
  fact: FACTMetrics;
  timing: {
    totalMs: number;
    avgStepMs: number;
  };
  metadata: {
    provider: string;
    timestamp: Date;
    config: Record<string, any>;
  };
}

export interface BenchmarkSummary {
  totalTasks: number;
  completedTasks: number;
  averageRACE: RACEMetrics;
  averageFACT: FACTMetrics;
  averageTimeMs: number;
  byCategory: Record<string, { race: number; fact: number; count: number }>;
  byDifficulty: Record<string, { race: number; fact: number; count: number }>;
}

// ============================================================================
// BENCHMARK TASKS
// ============================================================================

export const BENCHMARK_TASKS: BenchmarkTask[] = [
  // Technology - Easy
  {
    id: 'tech-easy-1',
    category: 'technology',
    difficulty: 'easy',
    question: 'What is Server-Driven UI (SDUI) and how does it work?',
    expectedTopics: ['server-driven', 'mobile', 'UI components', 'dynamic'],
    expectedSources: ['github', 'engineering blogs'],
  },
  {
    id: 'tech-easy-2',
    category: 'technology',
    difficulty: 'easy',
    question: 'What is React Server Components and why was it introduced?',
    expectedTopics: ['React', 'server components', 'SSR', 'performance'],
    expectedSources: ['reactjs.org', 'github'],
  },

  // Technology - Medium
  {
    id: 'tech-med-1',
    category: 'technology',
    difficulty: 'medium',
    question: 'How do companies like Airbnb and Lyft implement microfrontends at scale?',
    expectedTopics: ['microfrontends', 'module federation', 'deployment', 'teams'],
    expectedSources: ['engineering blogs', 'github'],
  },
  {
    id: 'tech-med-2',
    category: 'technology',
    difficulty: 'medium',
    question: 'What are the best practices for implementing a design system with tokens?',
    expectedTopics: ['design tokens', 'CSS variables', 'theming', 'components'],
    expectedSources: ['github', 'documentation'],
  },

  // Technology - Hard
  {
    id: 'tech-hard-1',
    category: 'technology',
    difficulty: 'hard',
    question: 'Compare different approaches to distributed tracing in microservices architectures',
    expectedTopics: ['tracing', 'OpenTelemetry', 'Jaeger', 'spans', 'correlation'],
    expectedSources: ['documentation', 'github', 'CNCF'],
  },
  {
    id: 'tech-hard-2',
    category: 'technology',
    difficulty: 'hard',
    question: 'What are the trade-offs between event sourcing and CQRS patterns?',
    expectedTopics: ['event sourcing', 'CQRS', 'eventual consistency', 'projections'],
    expectedSources: ['technical blogs', 'papers'],
  },

  // Science - Medium
  {
    id: 'sci-med-1',
    category: 'science',
    difficulty: 'medium',
    question: 'What are the key differences between transformer and mamba architectures for language models?',
    expectedTopics: ['transformer', 'mamba', 'attention', 'state space', 'efficiency'],
    expectedSources: ['arxiv', 'papers'],
  },

  // Science - Hard (PhD-level)
  {
    id: 'sci-hard-1',
    category: 'science',
    difficulty: 'phd-level',
    question: 'What are the current limitations of reinforcement learning from human feedback (RLHF) and proposed solutions?',
    expectedTopics: ['RLHF', 'reward hacking', 'constitutional AI', 'DPO'],
    expectedSources: ['arxiv', 'OpenAI', 'Anthropic'],
  },

  // Business - Medium
  {
    id: 'biz-med-1',
    category: 'business',
    difficulty: 'medium',
    question: 'What are effective strategies for reducing technical debt in legacy systems?',
    expectedTopics: ['refactoring', 'strangler fig', 'testing', 'incremental'],
    expectedSources: ['engineering blogs', 'case studies'],
  },

  // General - Easy
  {
    id: 'gen-easy-1',
    category: 'general',
    difficulty: 'easy',
    question: 'What are the main programming paradigms and when should each be used?',
    expectedTopics: ['OOP', 'functional', 'procedural', 'declarative'],
    expectedSources: ['educational', 'documentation'],
  },
];

// ============================================================================
// BENCHMARK RUNNER
// ============================================================================

export class ResearchBenchmark {
  private llm: LLMProvider;
  private results: BenchmarkResult[] = [];

  constructor(llm: LLMProvider) {
    this.llm = llm;
  }

  /**
   * Run a single benchmark task
   */
  async runTask(task: BenchmarkTask): Promise<BenchmarkResult> {
    console.log(`\n📊 Running benchmark: ${task.id}`);
    console.log(`   Question: ${task.question.substring(0, 60)}...`);

    const startTime = Date.now();

    const engine = new LLMDeepResearch(this.llm, {
      maxSteps: 8,
      maxSourcesPerQuery: 5,
      minConfidenceToStop: 0.6,
      enableSelfReflection: true,
      enableCrossValidation: true,
      authorityBoostEnabled: true,
    });

    // Track events
    let stepCount = 0;
    engine.on('step_completed', () => stepCount++);

    try {
      const report = await engine.research(task.question);
      const totalMs = Date.now() - startTime;

      // Calculate metrics
      const race = this.calculateRACE(task, report);
      const fact = this.calculateFACT(report);

      const result: BenchmarkResult = {
        task,
        report,
        race,
        fact,
        timing: {
          totalMs,
          avgStepMs: totalMs / Math.max(1, stepCount),
        },
        metadata: {
          provider: this.llm.name,
          timestamp: new Date(),
          config: {},
        },
      };

      console.log(`   ✓ RACE: ${(race.overall * 100).toFixed(0)}% | FACT: ${(fact.citationAccuracy * 100).toFixed(0)}%`);
      console.log(`   Time: ${(totalMs / 1000).toFixed(1)}s | Citations: ${fact.citationCount}`);

      this.results.push(result);
      return result;
    } catch (error) {
      console.log(`   ✗ Error: ${error}`);
      throw error;
    }
  }

  /**
   * Run all benchmark tasks
   */
  async runAll(tasks: BenchmarkTask[] = BENCHMARK_TASKS): Promise<BenchmarkSummary> {
    console.log('\n' + '='.repeat(60));
    console.log('DEEP RESEARCH BENCHMARK');
    console.log('Based on DeepResearch Bench (arxiv:2506.11763)');
    console.log('='.repeat(60));
    console.log(`Provider: ${this.llm.name}`);
    console.log(`Tasks: ${tasks.length}`);

    for (const task of tasks) {
      try {
        await this.runTask(task);
      } catch (e) {
        console.log(`   Skipping ${task.id} due to error`);
      }
    }

    return this.summarize();
  }

  /**
   * Calculate RACE metrics (Report quality)
   */
  private calculateRACE(task: BenchmarkTask, report: ResearchReport): RACEMetrics {
    const synthesis = report.executiveSummary + ' ' +
      report.sections.map(s => s.content).join(' ');
    const synthesisLower = synthesis.toLowerCase();

    // Relevance: Does report mention expected topics?
    const topicHits = task.expectedTopics.filter(topic =>
      synthesisLower.includes(topic.toLowerCase())
    );
    const relevance = topicHits.length / task.expectedTopics.length;

    // Accuracy: Based on citation verification and source quality
    const verifiedRatio = report.citations.filter(c => c.verified).length /
      Math.max(1, report.citations.length);
    const accuracy = (verifiedRatio + report.confidence) / 2;

    // Completeness: Word count, section count, citation count
    const wordCount = synthesis.split(/\s+/).length;
    const sectionScore = Math.min(1, report.sections.length / 3);
    const citationScore = Math.min(1, report.citations.length / 5);
    const wordScore = Math.min(1, wordCount / 500);
    const completeness = (sectionScore + citationScore + wordScore) / 3;

    // Engagement: Has recommendations, has limitations, structured
    const hasRecommendations = report.recommendations.length > 0 ? 0.3 : 0;
    const hasLimitations = report.limitations.length > 0 ? 0.3 : 0;
    const hasStructure = report.sections.length >= 2 ? 0.4 : 0.2;
    const engagement = hasRecommendations + hasLimitations + hasStructure;

    // Weighted overall score
    const overall = (
      relevance * 0.3 +
      accuracy * 0.3 +
      completeness * 0.25 +
      engagement * 0.15
    );

    return { relevance, accuracy, completeness, engagement, overall };
  }

  /**
   * Calculate FACT metrics (Citation accuracy)
   */
  private calculateFACT(report: ResearchReport): FACTMetrics {
    const citations = report.citations;
    const citationCount = citations.length;
    const verifiedCitations = citations.filter(c => c.verified).length;
    const citationAccuracy = citationCount > 0 ? verifiedCitations / citationCount : 0;

    // Source diversity: unique domains
    const domains = new Set(citations.map(c => {
      try {
        return new URL(c.url).hostname;
      } catch {
        return 'unknown';
      }
    }));
    const sourceDiversity = Math.min(1, domains.size / 5);

    // Authority score: average of source authority
    const authoritySum = citations.reduce((sum, c) => {
      return sum + this.getSourceAuthority(c.url);
    }, 0);
    const authorityScore = citationCount > 0 ? authoritySum / citationCount : 0;

    return {
      citationCount,
      verifiedCitations,
      citationAccuracy,
      sourceDiversity,
      authorityScore,
    };
  }

  private getSourceAuthority(url: string): number {
    try {
      const domain = new URL(url).hostname;
      // High authority domains
      if (domain.includes('arxiv.org')) return 0.95;
      if (domain.includes('github.com')) return 0.85;
      if (domain.includes('docs.') || domain.includes('developer.')) return 0.9;
      if (domain.includes('engineering')) return 0.85;
      if (domain.includes('stackoverflow')) return 0.75;
      if (domain.includes('medium.com')) return 0.6;
      return 0.5;
    } catch {
      return 0.3;
    }
  }

  /**
   * Summarize all results
   */
  summarize(): BenchmarkSummary {
    const completed = this.results.length;

    // Average RACE
    const avgRACE: RACEMetrics = {
      relevance: this.avg(r => r.race.relevance),
      accuracy: this.avg(r => r.race.accuracy),
      completeness: this.avg(r => r.race.completeness),
      engagement: this.avg(r => r.race.engagement),
      overall: this.avg(r => r.race.overall),
    };

    // Average FACT
    const avgFACT: FACTMetrics = {
      citationCount: this.avg(r => r.fact.citationCount),
      verifiedCitations: this.avg(r => r.fact.verifiedCitations),
      citationAccuracy: this.avg(r => r.fact.citationAccuracy),
      sourceDiversity: this.avg(r => r.fact.sourceDiversity),
      authorityScore: this.avg(r => r.fact.authorityScore),
    };

    // By category
    const byCategory: Record<string, { race: number; fact: number; count: number }> = {};
    for (const result of this.results) {
      const cat = result.task.category;
      if (!byCategory[cat]) {
        byCategory[cat] = { race: 0, fact: 0, count: 0 };
      }
      byCategory[cat].race += result.race.overall;
      byCategory[cat].fact += result.fact.citationAccuracy;
      byCategory[cat].count++;
    }
    for (const cat of Object.keys(byCategory)) {
      byCategory[cat].race /= byCategory[cat].count;
      byCategory[cat].fact /= byCategory[cat].count;
    }

    // By difficulty
    const byDifficulty: Record<string, { race: number; fact: number; count: number }> = {};
    for (const result of this.results) {
      const diff = result.task.difficulty;
      if (!byDifficulty[diff]) {
        byDifficulty[diff] = { race: 0, fact: 0, count: 0 };
      }
      byDifficulty[diff].race += result.race.overall;
      byDifficulty[diff].fact += result.fact.citationAccuracy;
      byDifficulty[diff].count++;
    }
    for (const diff of Object.keys(byDifficulty)) {
      byDifficulty[diff].race /= byDifficulty[diff].count;
      byDifficulty[diff].fact /= byDifficulty[diff].count;
    }

    const summary: BenchmarkSummary = {
      totalTasks: BENCHMARK_TASKS.length,
      completedTasks: completed,
      averageRACE: avgRACE,
      averageFACT: avgFACT,
      averageTimeMs: this.avg(r => r.timing.totalMs),
      byCategory,
      byDifficulty,
    };

    this.printSummary(summary);
    return summary;
  }

  private avg(fn: (r: BenchmarkResult) => number): number {
    if (this.results.length === 0) return 0;
    return this.results.reduce((sum, r) => sum + fn(r), 0) / this.results.length;
  }

  private printSummary(summary: BenchmarkSummary): void {
    console.log('\n' + '='.repeat(60));
    console.log('BENCHMARK SUMMARY');
    console.log('='.repeat(60));

    console.log(`\nTasks Completed: ${summary.completedTasks}/${summary.totalTasks}`);
    console.log(`Average Time: ${(summary.averageTimeMs / 1000).toFixed(1)}s per task`);

    console.log('\n--- RACE Metrics (Report Quality) ---');
    console.log(`  Overall:      ${(summary.averageRACE.overall * 100).toFixed(1)}%`);
    console.log(`  Relevance:    ${(summary.averageRACE.relevance * 100).toFixed(1)}%`);
    console.log(`  Accuracy:     ${(summary.averageRACE.accuracy * 100).toFixed(1)}%`);
    console.log(`  Completeness: ${(summary.averageRACE.completeness * 100).toFixed(1)}%`);
    console.log(`  Engagement:   ${(summary.averageRACE.engagement * 100).toFixed(1)}%`);

    console.log('\n--- FACT Metrics (Citation Accuracy) ---');
    console.log(`  Citation Count:    ${summary.averageFACT.citationCount.toFixed(1)}`);
    console.log(`  Citation Accuracy: ${(summary.averageFACT.citationAccuracy * 100).toFixed(1)}%`);
    console.log(`  Source Diversity:  ${(summary.averageFACT.sourceDiversity * 100).toFixed(1)}%`);
    console.log(`  Authority Score:   ${(summary.averageFACT.authorityScore * 100).toFixed(1)}%`);

    console.log('\n--- By Category ---');
    for (const [cat, scores] of Object.entries(summary.byCategory)) {
      console.log(`  ${cat}: RACE=${(scores.race * 100).toFixed(0)}% FACT=${(scores.fact * 100).toFixed(0)}% (n=${scores.count})`);
    }

    console.log('\n--- By Difficulty ---');
    for (const [diff, scores] of Object.entries(summary.byDifficulty)) {
      console.log(`  ${diff}: RACE=${(scores.race * 100).toFixed(0)}% FACT=${(scores.fact * 100).toFixed(0)}% (n=${scores.count})`);
    }

    // Comparison with SOTA
    console.log('\n--- Comparison with SOTA (DeepResearch Bench) ---');
    console.log('  Gemini 2.5 Deep Research: RACE=84.7% FACT=~90% Citations=111');
    console.log(`  Our Implementation:       RACE=${(summary.averageRACE.overall * 100).toFixed(1)}% FACT=${(summary.averageFACT.citationAccuracy * 100).toFixed(1)}% Citations=${summary.averageFACT.citationCount.toFixed(0)}`);

    console.log('\n' + '='.repeat(60));
  }
}

// ============================================================================
// CLI
// ============================================================================

import { fileURLToPath } from 'url';

const isMainModule = process.argv[1] && (
  process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1].includes('research_benchmark')
);

if (isMainModule) {
  // Select LLM provider
  let llm: LLMProvider;

  if (process.env.OPENROUTER_API_KEY) {
    const { OpenRouterLLMProvider } = await import('./llm_deep_research');
    llm = new OpenRouterLLMProvider(process.env.OPENROUTER_API_KEY);
  } else {
    console.log('Using smart rule-based provider (no API key found)');
    llm = new SmartRuleBasedProvider();
  }

  // Run benchmarks
  const benchmark = new ResearchBenchmark(llm);

  // Parse args for specific task or subset
  const taskId = process.argv[2];
  if (taskId) {
    const task = BENCHMARK_TASKS.find(t => t.id === taskId);
    if (task) {
      await benchmark.runTask(task);
    } else {
      console.log(`Task ${taskId} not found. Available: ${BENCHMARK_TASKS.map(t => t.id).join(', ')}`);
    }
  } else {
    // Run subset for quick test
    const quickTasks = BENCHMARK_TASKS.filter(t => t.difficulty === 'easy');
    await benchmark.runAll(quickTasks);
  }
}
