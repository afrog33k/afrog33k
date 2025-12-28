/**
 * Deep Research Harness for Ronald-GI
 *
 * Inspired by Tongyi DeepResearch's IterResearch paradigm.
 *
 * Key features:
 * - Evolving synthesis (compressed memory) not just URL lists
 * - Term expansion (SDUI → "server driven UI", "backend for frontend")
 * - Novelty detection (compare with existing knowledge)
 * - Curiosity score (how much more to learn)
 * - Settled score (is the question answered)
 * - Continuation logic (go deeper or stop)
 * - Cost/benefit tracking
 *
 * A research session is NOT just fetching 5 URLs.
 * It's a loop that continues until the question is answered.
 */

import { EventEmitter } from 'events';
import { fileURLToPath } from 'url';
import { ResearchAdapter, SearchResult, RepoInfo, PaperInfo } from './research_adapter';

// ============================================================================
// TYPES
// ============================================================================

export interface ResearchQuestion {
  original: string;           // The original question/topic
  expanded: string[];         // Expanded search terms
  subQuestions: string[];     // Derived sub-questions
  constraints: string[];      // User constraints (e.g., "must be open source")
}

export interface ResearchFinding {
  id: string;
  source: string;
  sourceType: 'web' | 'repo' | 'paper' | 'documentation';
  title: string;
  content: string;
  relevanceScore: number;     // 0-1: How relevant to the original question
  noveltyScore: number;       // 0-1: How new is this info (vs existing knowledge)
  credibilityScore: number;   // 0-1: How trustworthy is the source
  keyInsights: string[];      // Extracted key points
  newConcepts: string[];      // Concepts we didn't know before
  relatedQuestions: string[]; // New questions this raises
  timestamp: Date;
}

export interface ResearchSynthesis {
  summary: string;            // Current understanding synthesized
  answeredQuestions: string[];
  openQuestions: string[];
  keyFindings: ResearchFinding[];
  newConcepts: string[];      // All new concepts discovered
  recommendations: string[];   // Actionable recommendations
  confidenceLevel: number;    // 0-1: How confident in the synthesis
}

export interface ResearchSession {
  id: string;
  question: ResearchQuestion;
  findings: ResearchFinding[];
  synthesis: ResearchSynthesis;

  // Scores
  curiosityScore: number;     // 0-1: How much more to learn (high = more curious)
  settledScore: number;       // 0-1: How complete is the answer (high = done)
  costSoFar: number;          // Resources used (API calls, time, etc.)
  valueGenerated: number;     // Estimated value of findings

  // State
  status: 'active' | 'paused' | 'completed' | 'abandoned';
  iterationCount: number;
  maxIterations: number;
  startedAt: Date;
  updatedAt: Date;
}

export interface ResearchConfig {
  maxIterations: number;      // Max research loops
  maxSourcesPerQuery: number; // Max sources per search
  minRelevanceThreshold: number;
  minNoveltyThreshold: number;
  settledThreshold: number;   // When to stop (settled score)
  costBudget: number;         // Max cost before stopping
}

// ============================================================================
// TERM EXPANSION
// ============================================================================

const TERM_EXPANSIONS: Record<string, string[]> = {
  // UI patterns
  'sdui': ['server driven UI', 'server-driven UI', 'backend for frontend', 'BDUI', 'remote UI', 'dynamic UI configuration'],
  'microfrontend': ['micro-frontend', 'micro frontend', 'modular frontend', 'frontend composition', 'module federation'],
  'hmr': ['hot module replacement', 'hot reload', 'live reload', 'fast refresh', 'hot reloading'],

  // Frameworks
  'react': ['ReactJS', 'React.js', 'React framework'],
  'vue': ['Vue.js', 'VueJS'],
  'angular': ['AngularJS', 'Angular framework'],

  // AI/ML
  'llm': ['large language model', 'language model', 'GPT', 'transformer model'],
  'rag': ['retrieval augmented generation', 'retrieval-augmented generation'],
  'bdi': ['belief desire intention', 'BDI agent', 'intentional agent'],

  // ADHD
  'adhd': ['attention deficit', 'ADHD', 'neurodivergent', 'executive function'],
};

// ============================================================================
// DEEP RESEARCH ENGINE
// ============================================================================

export class DeepResearchEngine extends EventEmitter {
  private adapter: ResearchAdapter;
  private existingKnowledge: Set<string> = new Set();
  private config: ResearchConfig;

  constructor(config: Partial<ResearchConfig> = {}) {
    super();
    this.adapter = new ResearchAdapter();
    this.config = {
      maxIterations: config.maxIterations || 10,
      maxSourcesPerQuery: config.maxSourcesPerQuery || 5,
      minRelevanceThreshold: config.minRelevanceThreshold || 0.3,
      minNoveltyThreshold: config.minNoveltyThreshold || 0.2,
      settledThreshold: config.settledThreshold || 0.8,
      costBudget: config.costBudget || 100,
    };
  }

  // ==========================================================================
  // KNOWLEDGE BASE (for novelty detection)
  // ==========================================================================

  addExistingKnowledge(concepts: string[]): void {
    for (const concept of concepts) {
      this.existingKnowledge.add(concept.toLowerCase());
    }
  }

  // ==========================================================================
  // TERM EXPANSION
  // ==========================================================================

  expandTerms(query: string): string[] {
    const terms = new Set<string>([query]);
    const words = query.toLowerCase().split(/\s+/);

    for (const word of words) {
      if (TERM_EXPANSIONS[word]) {
        for (const expansion of TERM_EXPANSIONS[word]) {
          terms.add(expansion);
          // Also create combined queries
          terms.add(query.replace(new RegExp(word, 'gi'), expansion));
        }
      }
    }

    // Add common query patterns
    terms.add(`${query} tutorial`);
    terms.add(`${query} best practices`);
    terms.add(`${query} implementation`);
    terms.add(`${query} architecture`);
    terms.add(`${query} comparison`);

    return Array.from(terms);
  }

  // ==========================================================================
  // SUB-QUESTION GENERATION
  // ==========================================================================

  generateSubQuestions(topic: string): string[] {
    // Template-based sub-question generation
    return [
      `What is ${topic} and how does it work?`,
      `What are the main use cases for ${topic}?`,
      `What are the advantages and disadvantages of ${topic}?`,
      `What are the best implementations/examples of ${topic}?`,
      `How does ${topic} compare to alternatives?`,
      `What are common pitfalls when using ${topic}?`,
      `What is the current state of ${topic} in 2025?`,
    ];
  }

  // ==========================================================================
  // NOVELTY DETECTION
  // ==========================================================================

  calculateNovelty(content: string, concepts: string[]): number {
    // Check how many concepts are new
    const newConcepts = concepts.filter(c => !this.existingKnowledge.has(c.toLowerCase()));
    const conceptNovelty = concepts.length > 0 ? newConcepts.length / concepts.length : 0;

    // Check content novelty (simple: percentage of words not in existing knowledge)
    const words = content.toLowerCase().split(/\s+/).filter(w => w.length > 4);
    const newWords = words.filter(w => !this.existingKnowledge.has(w));
    const wordNovelty = words.length > 0 ? Math.min(1, newWords.length / words.length) : 0;

    return (conceptNovelty * 0.6 + wordNovelty * 0.4);
  }

  // ==========================================================================
  // RELEVANCE SCORING
  // ==========================================================================

  calculateRelevance(content: string, question: ResearchQuestion): number {
    const contentLower = content.toLowerCase();
    let score = 0;

    // Check original terms
    const originalTerms = question.original.toLowerCase().split(/\s+/);
    const matchedOriginal = originalTerms.filter(t => contentLower.includes(t));
    score += (matchedOriginal.length / originalTerms.length) * 0.4;

    // Check expanded terms
    const matchedExpanded = question.expanded.filter(t => contentLower.includes(t.toLowerCase()));
    score += (matchedExpanded.length / Math.max(1, question.expanded.length)) * 0.3;

    // Check if answers sub-questions
    const answered = question.subQuestions.filter(q => {
      const keywords = q.toLowerCase().split(/\s+/).filter(w => w.length > 4);
      return keywords.some(k => contentLower.includes(k));
    });
    score += (answered.length / Math.max(1, question.subQuestions.length)) * 0.3;

    return Math.min(1, score);
  }

  // ==========================================================================
  // CONCEPT EXTRACTION
  // ==========================================================================

  extractConcepts(content: string): string[] {
    const concepts: string[] = [];

    // Technical patterns
    const patterns = [
      /\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g,  // CamelCase
      /\b([A-Z]{2,})\b/g,                      // ACRONYMS
      /`([^`]+)`/g,                             // Code terms
      /\b([\w-]+(?:\.js|\.ts|\.py))\b/g,       // File names
      /\b([\w-]+\/[\w-]+)\b/g,                  // GitHub repos
    ];

    for (const pattern of patterns) {
      const matches = content.matchAll(pattern);
      for (const match of matches) {
        if (match[1] && match[1].length > 2 && match[1].length < 30) {
          concepts.push(match[1]);
        }
      }
    }

    // Deduplicate and limit
    return [...new Set(concepts)].slice(0, 20);
  }

  // ==========================================================================
  // KEY INSIGHT EXTRACTION
  // ==========================================================================

  extractInsights(content: string, question: string): string[] {
    const insights: string[] = [];
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 30);

    // Look for insight indicators
    const insightPatterns = [
      /\b(key|important|significant|critical|essential|main|primary)\b/i,
      /\b(advantage|benefit|pro|strength)\b/i,
      /\b(disadvantage|drawback|con|weakness|limitation)\b/i,
      /\b(best practice|recommended|should|must)\b/i,
      /\b(unlike|compared to|versus|vs)\b/i,
      /\b(novel|new|innovative|unique|first)\b/i,
    ];

    for (const sentence of sentences) {
      for (const pattern of insightPatterns) {
        if (pattern.test(sentence)) {
          insights.push(sentence.trim());
          break;
        }
      }
      if (insights.length >= 10) break;
    }

    return insights;
  }

  // ==========================================================================
  // RESEARCH LOOP
  // ==========================================================================

  async research(topic: string): Promise<ResearchSession> {
    const sessionId = `research-${Date.now()}`;

    // Build research question
    const question: ResearchQuestion = {
      original: topic,
      expanded: this.expandTerms(topic),
      subQuestions: this.generateSubQuestions(topic),
      constraints: [],
    };

    const session: ResearchSession = {
      id: sessionId,
      question,
      findings: [],
      synthesis: {
        summary: '',
        answeredQuestions: [],
        openQuestions: [...question.subQuestions],
        keyFindings: [],
        newConcepts: [],
        recommendations: [],
        confidenceLevel: 0,
      },
      curiosityScore: 1.0,  // Start very curious
      settledScore: 0,       // Start unsettled
      costSoFar: 0,
      valueGenerated: 0,
      status: 'active',
      iterationCount: 0,
      maxIterations: this.config.maxIterations,
      startedAt: new Date(),
      updatedAt: new Date(),
    };

    this.emit('session_started', { session });

    // Research loop
    while (
      session.status === 'active' &&
      session.iterationCount < session.maxIterations &&
      session.settledScore < this.config.settledThreshold &&
      session.costSoFar < this.config.costBudget
    ) {
      session.iterationCount++;
      this.emit('iteration_started', { iteration: session.iterationCount, session });

      // Decide what to search based on current state
      const searchQueries = this.selectSearchQueries(session);

      for (const query of searchQueries) {
        // Search multiple sources
        const [webResults, repoResults, paperResults] = await Promise.all([
          this.adapter.webSearch(query, this.config.maxSourcesPerQuery),
          this.adapter.searchRepos(query, 3),
          this.adapter.searchArxiv(query, 2),
        ]);

        session.costSoFar += 3; // Count API calls

        // Process web results
        for (const result of webResults) {
          const finding = await this.processFinding(result, 'web', question, session);
          if (finding && finding.relevanceScore >= this.config.minRelevanceThreshold) {
            session.findings.push(finding);
            this.emit('finding_added', { finding, session });
          }
        }

        // Process repo results
        for (const repo of repoResults) {
          const readme = await this.adapter.fetchReadme(repo.fullName);
          if (readme) {
            const finding = await this.processRepoFinding(repo, readme, question, session);
            if (finding && finding.relevanceScore >= this.config.minRelevanceThreshold) {
              session.findings.push(finding);
              this.emit('finding_added', { finding, session });
            }
          }
          session.costSoFar += 1;
        }

        // Process paper results
        for (const paper of paperResults) {
          const finding = this.processPaperFinding(paper, question, session);
          if (finding && finding.relevanceScore >= this.config.minRelevanceThreshold) {
            session.findings.push(finding);
            this.emit('finding_added', { finding, session });
          }
        }
      }

      // Update synthesis
      this.updateSynthesis(session);

      // Update scores
      this.updateScores(session);

      this.emit('iteration_complete', {
        iteration: session.iterationCount,
        curiosityScore: session.curiosityScore,
        settledScore: session.settledScore,
        findingsCount: session.findings.length,
      });

      // Check if we should continue
      if (session.settledScore >= this.config.settledThreshold) {
        session.status = 'completed';
        this.emit('research_complete', { reason: 'settled', session });
      } else if (session.costSoFar >= this.config.costBudget) {
        session.status = 'abandoned';
        this.emit('research_complete', { reason: 'budget_exceeded', session });
      } else if (session.curiosityScore < 0.1 && session.settledScore > 0.5) {
        session.status = 'completed';
        this.emit('research_complete', { reason: 'diminishing_returns', session });
      }

      session.updatedAt = new Date();
    }

    if (session.status === 'active') {
      session.status = 'completed';
      this.emit('research_complete', { reason: 'max_iterations', session });
    }

    return session;
  }

  // ==========================================================================
  // SEARCH QUERY SELECTION
  // ==========================================================================

  private selectSearchQueries(session: ResearchSession): string[] {
    const queries: string[] = [];

    if (session.iterationCount === 1) {
      // First iteration: use original and top expansions
      queries.push(session.question.original);
      queries.push(...session.question.expanded.slice(0, 3));
    } else {
      // Subsequent iterations: focus on open questions
      const openQuestions = session.synthesis.openQuestions.slice(0, 2);
      queries.push(...openQuestions.map(q => q.replace(/\?$/, '')));

      // Also search for new concepts we just discovered
      const recentConcepts = session.synthesis.newConcepts.slice(-3);
      for (const concept of recentConcepts) {
        queries.push(`${session.question.original} ${concept}`);
      }
    }

    return queries.slice(0, 5); // Limit per iteration
  }

  // ==========================================================================
  // FINDING PROCESSING
  // ==========================================================================

  private async processFinding(
    result: SearchResult,
    sourceType: ResearchFinding['sourceType'],
    question: ResearchQuestion,
    session: ResearchSession
  ): Promise<ResearchFinding | null> {
    // Try to fetch full content, but use snippet as fallback
    let content = await this.adapter.fetchContent(result.url);

    // Use snippet if full content fetch failed
    if (!content || content.length < 100) {
      if (result.snippet && result.snippet.length > 30) {
        content = `${result.title}\n\n${result.snippet}`;
      } else {
        return null; // No content at all
      }
    }

    const concepts = this.extractConcepts(content);
    const insights = this.extractInsights(content, question.original);
    const relevance = this.calculateRelevance(content, question);
    const novelty = this.calculateNovelty(content, concepts);

    // Extract new questions raised
    const relatedQuestions: string[] = [];
    if (content.includes('?')) {
      const questions = content.match(/[^.!?]*\?/g) || [];
      relatedQuestions.push(...questions.slice(0, 3).map(q => q.trim()));
    }

    // Identify truly new concepts
    const newConcepts = concepts.filter(c =>
      !this.existingKnowledge.has(c.toLowerCase()) &&
      !session.synthesis.newConcepts.includes(c)
    );

    return {
      id: `finding-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      source: result.url,
      sourceType,
      title: result.title,
      content: content.substring(0, 2000),
      relevanceScore: relevance,
      noveltyScore: novelty,
      credibilityScore: this.estimateCredibility(result.url),
      keyInsights: insights,
      newConcepts,
      relatedQuestions,
      timestamp: new Date(),
    };
  }

  private async processRepoFinding(
    repo: RepoInfo,
    readme: string,
    question: ResearchQuestion,
    session: ResearchSession
  ): Promise<ResearchFinding | null> {
    const concepts = this.extractConcepts(readme);
    const insights = this.extractInsights(readme, question.original);
    const relevance = this.calculateRelevance(readme, question);
    const novelty = this.calculateNovelty(readme, concepts);

    const newConcepts = concepts.filter(c =>
      !this.existingKnowledge.has(c.toLowerCase()) &&
      !session.synthesis.newConcepts.includes(c)
    );

    // Add repo-specific insights
    const repoInsights = [
      `Repository: ${repo.fullName} with ${repo.stars} stars`,
      `Language: ${repo.language}`,
      `Topics: ${repo.topics.join(', ')}`,
      ...insights,
    ];

    return {
      id: `finding-repo-${repo.id}`,
      source: repo.url,
      sourceType: 'repo',
      title: `${repo.fullName} - ${repo.description}`,
      content: readme.substring(0, 3000),
      relevanceScore: relevance,
      noveltyScore: novelty,
      credibilityScore: Math.min(1, 0.5 + (repo.stars / 10000)),
      keyInsights: repoInsights,
      newConcepts,
      relatedQuestions: [],
      timestamp: new Date(),
    };
  }

  private processPaperFinding(
    paper: PaperInfo,
    question: ResearchQuestion,
    session: ResearchSession
  ): ResearchFinding {
    const content = `${paper.title}\n\n${paper.abstract}`;
    const concepts = this.extractConcepts(content);
    const relevance = this.calculateRelevance(content, question);
    const novelty = this.calculateNovelty(content, concepts);

    const newConcepts = concepts.filter(c =>
      !this.existingKnowledge.has(c.toLowerCase()) &&
      !session.synthesis.newConcepts.includes(c)
    );

    return {
      id: paper.id,
      source: paper.url,
      sourceType: 'paper',
      title: paper.title,
      content: paper.abstract,
      relevanceScore: relevance,
      noveltyScore: novelty,
      credibilityScore: 0.9, // Academic papers are high credibility
      keyInsights: [paper.abstract.substring(0, 300)],
      newConcepts,
      relatedQuestions: [],
      timestamp: new Date(),
    };
  }

  // ==========================================================================
  // CREDIBILITY ESTIMATION
  // ==========================================================================

  private estimateCredibility(url: string): number {
    const highCredibility = ['github.com', 'arxiv.org', 'acm.org', 'ieee.org', 'microsoft.com', 'google.com'];
    const mediumCredibility = ['medium.com', 'dev.to', 'stackoverflow.com', 'wikipedia.org'];

    for (const domain of highCredibility) {
      if (url.includes(domain)) return 0.8;
    }
    for (const domain of mediumCredibility) {
      if (url.includes(domain)) return 0.6;
    }
    return 0.4;
  }

  // ==========================================================================
  // SYNTHESIS UPDATE
  // ==========================================================================

  private updateSynthesis(session: ResearchSession): void {
    const { findings, synthesis, question } = session;

    // Collect all new concepts
    synthesis.newConcepts = [...new Set(
      findings.flatMap(f => f.newConcepts)
    )];

    // Update existing knowledge
    this.addExistingKnowledge(synthesis.newConcepts);

    // Identify answered questions
    for (const subQ of question.subQuestions) {
      const answered = findings.some(f =>
        f.relevanceScore > 0.5 &&
        f.keyInsights.some(i => i.toLowerCase().includes(subQ.toLowerCase().split(' ').slice(2).join(' ')))
      );
      if (answered && !synthesis.answeredQuestions.includes(subQ)) {
        synthesis.answeredQuestions.push(subQ);
        synthesis.openQuestions = synthesis.openQuestions.filter(q => q !== subQ);
      }
    }

    // Add new questions from findings
    const newQuestions = findings.flatMap(f => f.relatedQuestions);
    for (const q of newQuestions) {
      if (!synthesis.openQuestions.includes(q) && !synthesis.answeredQuestions.includes(q)) {
        synthesis.openQuestions.push(q);
      }
    }

    // Select key findings (top by relevance × novelty)
    synthesis.keyFindings = [...findings]
      .sort((a, b) => (b.relevanceScore * b.noveltyScore) - (a.relevanceScore * a.noveltyScore))
      .slice(0, 5);

    // Generate recommendations
    synthesis.recommendations = this.generateRecommendations(session);

    // Generate summary
    synthesis.summary = this.generateSummary(session);

    // Update confidence
    synthesis.confidenceLevel = this.calculateConfidence(session);
  }

  // ==========================================================================
  // SCORE UPDATES
  // ==========================================================================

  private updateScores(session: ResearchSession): void {
    const { findings, synthesis, question } = session;

    // Settled score: based on questions answered and finding quality
    const questionCoverage = synthesis.answeredQuestions.length / question.subQuestions.length;
    const avgRelevance = findings.length > 0
      ? findings.reduce((s, f) => s + f.relevanceScore, 0) / findings.length
      : 0;
    const avgCredibility = findings.length > 0
      ? findings.reduce((s, f) => s + f.credibilityScore, 0) / findings.length
      : 0;

    session.settledScore = (questionCoverage * 0.4 + avgRelevance * 0.3 + avgCredibility * 0.3);

    // Curiosity score: based on novelty and open questions
    const avgNovelty = findings.length > 0
      ? findings.reduce((s, f) => s + f.noveltyScore, 0) / findings.length
      : 1;
    const openQuestionRatio = synthesis.openQuestions.length /
      (synthesis.openQuestions.length + synthesis.answeredQuestions.length + 1);

    session.curiosityScore = (avgNovelty * 0.5 + openQuestionRatio * 0.5);

    // Value generated: based on new concepts and insights
    session.valueGenerated =
      synthesis.newConcepts.length * 2 +
      findings.reduce((s, f) => s + f.keyInsights.length, 0) +
      synthesis.answeredQuestions.length * 5;
  }

  // ==========================================================================
  // SUMMARY GENERATION
  // ==========================================================================

  private generateSummary(session: ResearchSession): string {
    const { findings, synthesis, question } = session;

    const topFindings = synthesis.keyFindings.slice(0, 3);
    const findingSummary = topFindings
      .map(f => `- ${f.title}: ${f.keyInsights[0] || 'No specific insight'}`)
      .join('\n');

    const conceptsSummary = synthesis.newConcepts.length > 0
      ? `New concepts discovered: ${synthesis.newConcepts.slice(0, 5).join(', ')}`
      : 'No new concepts discovered.';

    return `## Research Summary: ${question.original}

### Key Findings
${findingSummary || 'No significant findings yet.'}

### ${conceptsSummary}

### Questions Answered (${synthesis.answeredQuestions.length}/${question.subQuestions.length})
${synthesis.answeredQuestions.map(q => `- ✅ ${q}`).join('\n') || 'None yet.'}

### Open Questions
${synthesis.openQuestions.slice(0, 5).map(q => `- ❓ ${q}`).join('\n') || 'All questions addressed.'}

### Sources Reviewed
- Web pages: ${findings.filter(f => f.sourceType === 'web').length}
- GitHub repos: ${findings.filter(f => f.sourceType === 'repo').length}
- Academic papers: ${findings.filter(f => f.sourceType === 'paper').length}

### Confidence: ${(synthesis.confidenceLevel * 100).toFixed(0)}%
`;
  }

  // ==========================================================================
  // RECOMMENDATIONS
  // ==========================================================================

  private generateRecommendations(session: ResearchSession): string[] {
    const recommendations: string[] = [];
    const { findings, synthesis } = session;

    // Repo recommendations
    const topRepos = findings
      .filter(f => f.sourceType === 'repo')
      .sort((a, b) => b.credibilityScore - a.credibilityScore);

    if (topRepos.length > 0) {
      recommendations.push(`Review repository: ${topRepos[0].source}`);
    }

    // Paper recommendations
    const papers = findings.filter(f => f.sourceType === 'paper');
    if (papers.length > 0) {
      recommendations.push(`Read paper: ${papers[0].title}`);
    }

    // Concept exploration
    if (synthesis.newConcepts.length > 0) {
      recommendations.push(`Explore new concept: ${synthesis.newConcepts[0]}`);
    }

    // Open question follow-up
    if (synthesis.openQuestions.length > 0) {
      recommendations.push(`Investigate: ${synthesis.openQuestions[0]}`);
    }

    return recommendations;
  }

  // ==========================================================================
  // CONFIDENCE CALCULATION
  // ==========================================================================

  private calculateConfidence(session: ResearchSession): number {
    const { findings, synthesis } = session;

    if (findings.length === 0) return 0;

    // Source diversity
    const sourceTypes = new Set(findings.map(f => f.sourceType));
    const diversityScore = sourceTypes.size / 4;

    // Answer coverage
    const coverageScore = synthesis.answeredQuestions.length /
      (session.question.subQuestions.length || 1);

    // Credibility average
    const credibilityScore = findings.reduce((s, f) => s + f.credibilityScore, 0) / findings.length;

    // Agreement between sources
    const agreementScore = this.calculateSourceAgreement(findings);

    return Math.min(1, (
      diversityScore * 0.2 +
      coverageScore * 0.3 +
      credibilityScore * 0.3 +
      agreementScore * 0.2
    ));
  }

  private calculateSourceAgreement(findings: ResearchFinding[]): number {
    if (findings.length < 2) return 0.5;

    // Simple: check concept overlap between findings
    const allConcepts = findings.map(f => new Set(f.newConcepts.map(c => c.toLowerCase())));
    let overlaps = 0;
    let comparisons = 0;

    for (let i = 0; i < allConcepts.length; i++) {
      for (let j = i + 1; j < allConcepts.length; j++) {
        const intersection = [...allConcepts[i]].filter(c => allConcepts[j].has(c));
        const union = new Set([...allConcepts[i], ...allConcepts[j]]);
        overlaps += union.size > 0 ? intersection.length / union.size : 0;
        comparisons++;
      }
    }

    return comparisons > 0 ? overlaps / comparisons : 0.5;
  }
}

// ============================================================================
// CLI TEST
// ============================================================================

const isMainModule = process.argv[1] && (
  process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1].includes('deep_research')
);
if (isMainModule) {
  const engine = new DeepResearchEngine({
    maxIterations: 3,
    maxSourcesPerQuery: 3,
    settledThreshold: 0.7,
  });

  // Add some existing knowledge
  engine.addExistingKnowledge(['react', 'javascript', 'typescript', 'frontend']);

  engine.on('session_started', ({ session }) => {
    console.log('\n🔬 Research Session Started');
    console.log(`   Question: ${session.question.original}`);
    console.log(`   Expanded terms: ${session.question.expanded.slice(0, 5).join(', ')}...`);
    console.log(`   Sub-questions: ${session.question.subQuestions.length}`);
  });

  engine.on('iteration_started', ({ iteration }) => {
    console.log(`\n📍 Iteration ${iteration}`);
  });

  engine.on('finding_added', ({ finding }) => {
    console.log(`   📄 Found: ${finding.title.substring(0, 50)}...`);
    console.log(`      Relevance: ${(finding.relevanceScore * 100).toFixed(0)}% | Novelty: ${(finding.noveltyScore * 100).toFixed(0)}%`);
    if (finding.newConcepts.length > 0) {
      console.log(`      New concepts: ${finding.newConcepts.slice(0, 3).join(', ')}`);
    }
  });

  engine.on('iteration_complete', ({ iteration, curiosityScore, settledScore, findingsCount }) => {
    console.log(`   ✅ Iteration ${iteration} complete`);
    console.log(`      Findings: ${findingsCount} | Curiosity: ${(curiosityScore * 100).toFixed(0)}% | Settled: ${(settledScore * 100).toFixed(0)}%`);
  });

  engine.on('research_complete', ({ reason, session }) => {
    console.log(`\n🏁 Research Complete: ${reason}`);
    console.log(`\n${session.synthesis.summary}`);
    console.log(`\n📊 Final Scores:`);
    console.log(`   Curiosity: ${(session.curiosityScore * 100).toFixed(0)}%`);
    console.log(`   Settled: ${(session.settledScore * 100).toFixed(0)}%`);
    console.log(`   Cost: ${session.costSoFar}`);
    console.log(`   Value: ${session.valueGenerated}`);
    console.log(`   Cost/Value Ratio: ${(session.costSoFar / Math.max(1, session.valueGenerated)).toFixed(2)}`);
  });

  const topic = process.argv[2] || 'SDUI microfrontend react HMR';
  console.log(`\n🔍 Starting deep research on: "${topic}"\n`);

  engine.research(topic).then(session => {
    console.log('\n\n=== RECOMMENDATIONS ===');
    session.synthesis.recommendations.forEach(r => console.log(`• ${r}`));
  }).catch(console.error);
}
