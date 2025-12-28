/**
 * LLM-Powered Deep Research Engine
 *
 * Based on Tongyi DeepResearch's IterResearch paradigm:
 * - Workspace reconstruction (question + evolving synthesis + last context)
 * - ReAct loop (Think → Act → Observe → Synthesize)
 * - Multi-step reasoning with LLM guidance
 * - Citation verification
 * - Parallel exploration in "heavy" mode
 *
 * Reference: https://arxiv.org/abs/2510.24701
 */

import { EventEmitter } from 'events';
import { ResearchAdapter, SearchResult, RepoInfo, PaperInfo } from './research_adapter';

// ============================================================================
// TYPES
// ============================================================================

export interface ResearchQuestion {
  original: string;
  clarified?: string;      // LLM-clarified version
  subQuestions: string[];  // LLM-generated sub-questions
  scope: string[];         // What's in scope
  outOfScope: string[];    // What to avoid
}

export interface Citation {
  id: string;
  url: string;
  title: string;
  content: string;         // Actual content fetched
  claimSupported: string;  // What claim this supports
  verified: boolean;       // Did we verify it supports the claim?
  verificationNote?: string;
}

export interface ResearchStep {
  stepNumber: number;
  thought: string;         // LLM's reasoning
  action: ResearchAction;
  observation: string;     // What was returned
  synthesis: string;       // How this updates understanding
  timestamp: Date;
}

export type ResearchAction =
  | { type: 'search_web'; query: string }
  | { type: 'search_repos'; query: string }
  | { type: 'search_papers'; query: string }
  | { type: 'read_url'; url: string }
  | { type: 'synthesize'; focus: string }
  | { type: 'verify_citation'; citation: Citation }
  | { type: 'ask_subquestion'; question: string }
  | { type: 'conclude'; summary: string };

export interface Workspace {
  question: ResearchQuestion;
  synthesis: string;           // Evolving compressed memory
  lastStep: ResearchStep | null;
  citations: Citation[];
  openQuestions: string[];
  answeredQuestions: string[];
  confidence: number;          // 0-1
  iteration: number;
}

export interface ResearchReport {
  id: string;
  question: string;
  executiveSummary: string;
  sections: ReportSection[];
  citations: Citation[];
  methodology: string;
  limitations: string[];
  recommendations: string[];
  confidence: number;
  metadata: {
    stepsExecuted: number;
    sourcesConsulted: number;
    timeElapsed: number;
    tokensUsed: number;
  };
}

export interface ReportSection {
  title: string;
  content: string;
  citations: string[];  // Citation IDs
}

export interface LLMProvider {
  complete(prompt: string, options?: { maxTokens?: number; temperature?: number }): Promise<string>;
  name: string;
}

export interface ResearchConfig {
  maxSteps: number;
  maxSourcesPerQuery: number;
  minConfidenceToStop: number;
  enableParallelMode: boolean;
  parallelAgents: number;
  verifyAllCitations: boolean;
  enableSelfReflection: boolean;      // Error-reflection loop from Step-DeepResearch
  maxReflectionRetries: number;       // Max retries per step (default: 3)
  enableCrossValidation: boolean;     // Multi-source verification
  crossValidationThreshold: number;   // Min sources to validate a claim
  authorityBoostEnabled: boolean;     // Boost authoritative sources
}

// Authority ranking from Step-DeepResearch (curated authoritative domains)
export const AUTHORITY_DOMAINS: Record<string, number> = {
  // Tech documentation (highest authority)
  'developer.mozilla.org': 1.0,
  'docs.microsoft.com': 1.0,
  'developer.apple.com': 1.0,
  'cloud.google.com': 0.95,
  'aws.amazon.com': 0.95,
  'kubernetes.io': 0.95,
  'reactjs.org': 0.95,
  'vuejs.org': 0.95,
  'angular.io': 0.95,
  // Academic/research
  'arxiv.org': 0.95,
  'scholar.google.com': 0.9,
  'dl.acm.org': 0.9,
  'ieee.org': 0.9,
  // Engineering blogs (high authority)
  'engineering.fb.com': 0.85,
  'netflixtechblog.com': 0.85,
  'eng.uber.com': 0.85,
  'medium.com/airbnb-engineering': 0.85,
  'blog.google': 0.85,
  'github.blog': 0.85,
  // News/content
  'stackoverflow.com': 0.8,
  'github.com': 0.8,
  'hackernews.com': 0.75,
  'medium.com': 0.6,
  'dev.to': 0.6,
  // Default
  'default': 0.5,
};

// Self-reflection types
export interface ReflectionResult {
  success: boolean;
  issue?: string;
  suggestion?: string;
  shouldRetry: boolean;
  modifiedAction?: ResearchAction;
}

// Cross-validation types
export interface ValidatedClaim {
  claim: string;
  sources: Citation[];
  validationScore: number;  // 0-1 based on source agreement
  conflicts: string[];       // Conflicting information found
}

// ============================================================================
// PROMPTS
// ============================================================================

const PROMPTS = {
  clarifyQuestion: (question: string) => `You are a research assistant. Given this research question, clarify it and break it into sub-questions.

QUESTION: ${question}

Respond in this exact JSON format:
{
  "clarified": "A clearer, more specific version of the question",
  "subQuestions": ["Sub-question 1", "Sub-question 2", ...],
  "scope": ["What's in scope"],
  "outOfScope": ["What to avoid researching"]
}`,

  planNextAction: (workspace: Workspace) => `You are a research agent. Based on your current workspace, decide what to do next.

ORIGINAL QUESTION: ${workspace.question.original}
CLARIFIED: ${workspace.question.clarified || workspace.question.original}

CURRENT SYNTHESIS:
${workspace.synthesis || "No findings yet."}

LAST STEP:
${workspace.lastStep ? `
Thought: ${workspace.lastStep.thought}
Action: ${JSON.stringify(workspace.lastStep.action)}
Observation: ${workspace.lastStep.observation.substring(0, 500)}...
` : "This is the first step."}

OPEN QUESTIONS: ${workspace.openQuestions.join(', ') || 'None identified yet'}
ANSWERED: ${workspace.answeredQuestions.join(', ') || 'None yet'}
CITATIONS SO FAR: ${workspace.citations.length}
CONFIDENCE: ${(workspace.confidence * 100).toFixed(0)}%
ITERATION: ${workspace.iteration}

Decide what to do next. Available actions:
- search_web: Search the web for information
- search_repos: Search GitHub for relevant code/projects
- search_papers: Search academic papers (only for academic topics)
- read_url: Read a specific URL in detail
- synthesize: Consolidate current findings
- verify_citation: Verify a citation supports its claim
- ask_subquestion: Investigate a sub-question
- conclude: Finish research and generate report

Respond in this exact JSON format:
{
  "thought": "Your reasoning about what to do next and why",
  "action": {
    "type": "action_type",
    "query": "search query" OR "url": "url to read" OR "focus": "synthesis focus" OR "question": "sub-question" OR "summary": "conclusion"
  }
}`,

  synthesize: (workspace: Workspace, newObservation: string) => `You are synthesizing research findings. Update your understanding based on new information.

QUESTION: ${workspace.question.original}

PREVIOUS SYNTHESIS:
${workspace.synthesis || "No previous synthesis."}

NEW INFORMATION:
${newObservation}

Write an updated synthesis that:
1. Incorporates the new information
2. Notes what questions this answers
3. Notes what new questions arise
4. Maintains a coherent narrative
5. Cites sources where applicable

Keep it concise but comprehensive (max 500 words).`,

  verifyCitation: (citation: Citation) => `Verify if this source supports the claimed assertion.

CLAIM: ${citation.claimSupported}

SOURCE TITLE: ${citation.title}
SOURCE URL: ${citation.url}
SOURCE CONTENT:
${citation.content.substring(0, 2000)}

Does this source adequately support the claim? Respond in JSON:
{
  "verified": true/false,
  "explanation": "Why or why not",
  "actualSupport": "What the source actually says about this topic"
}`,

  // Self-reflection prompt (Step-DeepResearch error-reflection loop)
  reflectOnStep: (step: ResearchStep, workspace: Workspace) => `You are a research agent reflecting on your last action.

ORIGINAL QUESTION: ${workspace.question.original}
CURRENT CONFIDENCE: ${(workspace.confidence * 100).toFixed(0)}%

LAST ACTION:
Thought: ${step.thought}
Action: ${JSON.stringify(step.action)}
Result: ${step.observation.substring(0, 1000)}

Evaluate if this action was successful and helpful. Consider:
1. Did we get relevant information?
2. Did this advance our understanding?
3. Was the search query effective?
4. Are there any errors or issues?

Respond in JSON:
{
  "success": true/false,
  "issue": "What went wrong (if applicable)",
  "suggestion": "How to improve the approach",
  "shouldRetry": true/false,
  "modifiedAction": { "type": "...", ... } // Only if shouldRetry is true
}`,

  // Cross-validation prompt
  crossValidate: (claim: string, sources: Citation[]) => `Validate if these sources agree on the following claim.

CLAIM: ${claim}

SOURCES:
${sources.map((s, i) => `[${i + 1}] ${s.title}:\n${s.content.substring(0, 500)}`).join('\n\n')}

Analyze source agreement. Respond in JSON:
{
  "validationScore": 0.0-1.0,
  "agreementSummary": "What sources agree on",
  "conflicts": ["Any conflicting information"],
  "confidence": "high/medium/low"
}`,

  generateReport: (workspace: Workspace, steps: ResearchStep[]) => `Generate a comprehensive research report.

QUESTION: ${workspace.question.original}

SYNTHESIS:
${workspace.synthesis}

CITATIONS:
${workspace.citations.map(c => `[${c.id}] ${c.title} - ${c.url}`).join('\n')}

ANSWERED QUESTIONS:
${workspace.answeredQuestions.map(q => `- ${q}`).join('\n')}

OPEN QUESTIONS:
${workspace.openQuestions.map(q => `- ${q}`).join('\n')}

Generate a structured research report in this JSON format:
{
  "executiveSummary": "2-3 paragraph summary of key findings",
  "sections": [
    {"title": "Section Title", "content": "Section content with [1] style citations", "citations": ["citation-id-1"]}
  ],
  "methodology": "How the research was conducted",
  "limitations": ["Limitation 1", "Limitation 2"],
  "recommendations": ["Actionable recommendation 1", "Recommendation 2"]
}`
};

// ============================================================================
// LLM DEEP RESEARCH ENGINE
// ============================================================================

export class LLMDeepResearch extends EventEmitter {
  private adapter: ResearchAdapter;
  private llm: LLMProvider;
  private config: ResearchConfig;

  private validatedClaims: ValidatedClaim[] = [];
  private reflectionHistory: Map<number, ReflectionResult[]> = new Map();

  constructor(llm: LLMProvider, config: Partial<ResearchConfig> = {}) {
    super();
    this.adapter = new ResearchAdapter();
    this.llm = llm;
    this.config = {
      maxSteps: config.maxSteps || 20,
      maxSourcesPerQuery: config.maxSourcesPerQuery || 5,
      minConfidenceToStop: config.minConfidenceToStop || 0.8,
      enableParallelMode: config.enableParallelMode || false,
      parallelAgents: config.parallelAgents || 3,
      verifyAllCitations: config.verifyAllCitations ?? true,
      enableSelfReflection: config.enableSelfReflection ?? true,
      maxReflectionRetries: config.maxReflectionRetries || 3,
      enableCrossValidation: config.enableCrossValidation ?? true,
      crossValidationThreshold: config.crossValidationThreshold || 2,
      authorityBoostEnabled: config.authorityBoostEnabled ?? true,
    };
  }

  // ==========================================================================
  // MAIN RESEARCH LOOP
  // ==========================================================================

  async research(question: string): Promise<ResearchReport> {
    const startTime = Date.now();
    let tokensUsed = 0;

    this.emit('research_started', { question });

    // Step 1: Clarify the question
    const clarifiedQuestion = await this.clarifyQuestion(question);
    tokensUsed += 500; // Estimate

    // Step 2: Initialize workspace
    const workspace: Workspace = {
      question: clarifiedQuestion,
      synthesis: '',
      lastStep: null,
      citations: [],
      openQuestions: [...clarifiedQuestion.subQuestions],
      answeredQuestions: [],
      confidence: 0,
      iteration: 0,
    };

    const steps: ResearchStep[] = [];

    // Step 3: ReAct loop
    while (
      workspace.iteration < this.config.maxSteps &&
      workspace.confidence < this.config.minConfidenceToStop
    ) {
      workspace.iteration++;
      this.emit('iteration_started', { iteration: workspace.iteration, workspace });

      // Get next action from LLM
      const { thought, action } = await this.planNextAction(workspace);
      tokensUsed += 300;

      // Execute action
      const observation = await this.executeAction(action, workspace);
      tokensUsed += 200;

      // Synthesize new understanding
      const newSynthesis = await this.synthesizeFindings(workspace, observation);
      tokensUsed += 400;

      // Create step record
      const step: ResearchStep = {
        stepNumber: workspace.iteration,
        thought,
        action,
        observation: observation.substring(0, 2000),
        synthesis: newSynthesis,
        timestamp: new Date(),
      };
      steps.push(step);

      // Update workspace
      workspace.synthesis = newSynthesis;
      workspace.lastStep = step;
      workspace.confidence = this.estimateConfidence(workspace);

      this.emit('step_completed', { step, workspace });

      // Self-reflection (Step-DeepResearch error-reflection loop)
      if (this.config.enableSelfReflection && action.type !== 'conclude') {
        const reflection = await this.reflectOnStep(step, workspace);
        this.trackReflection(workspace.iteration, reflection);

        if (!reflection.success && reflection.shouldRetry) {
          // Retry with modified action (up to maxReflectionRetries)
          const retries = this.reflectionHistory.get(workspace.iteration)?.length || 0;
          if (retries < this.config.maxReflectionRetries && reflection.modifiedAction) {
            this.emit('reflection_retry', { step, reflection, retryCount: retries });

            // Re-execute with modified action
            const retryObservation = await this.executeAction(reflection.modifiedAction, workspace);
            step.observation = retryObservation;
            step.synthesis = await this.synthesizeFindings(workspace, retryObservation);
            workspace.synthesis = step.synthesis;
          }
        }
        tokensUsed += 200;
      }

      // Check for conclusion action
      if (action.type === 'conclude') {
        break;
      }
    }

    // Cross-validation of key claims (after main loop)
    if (this.config.enableCrossValidation && workspace.citations.length >= this.config.crossValidationThreshold) {
      await this.crossValidateClaims(workspace);
      tokensUsed += workspace.citations.length * 100;
    }

    // Step 4: Verify citations if enabled
    if (this.config.verifyAllCitations) {
      await this.verifyCitations(workspace);
      tokensUsed += workspace.citations.length * 200;
    }

    // Step 5: Generate final report
    const report = await this.generateReport(workspace, steps);
    tokensUsed += 600;

    report.metadata = {
      stepsExecuted: steps.length,
      sourcesConsulted: workspace.citations.length,
      timeElapsed: Date.now() - startTime,
      tokensUsed,
    };

    this.emit('research_completed', { report });

    return report;
  }

  // ==========================================================================
  // QUESTION CLARIFICATION
  // ==========================================================================

  private async clarifyQuestion(question: string): Promise<ResearchQuestion> {
    const prompt = PROMPTS.clarifyQuestion(question);
    const response = await this.llm.complete(prompt);

    try {
      const parsed = JSON.parse(this.extractJSON(response));
      return {
        original: question,
        clarified: parsed.clarified,
        subQuestions: parsed.subQuestions || [],
        scope: parsed.scope || [],
        outOfScope: parsed.outOfScope || [],
      };
    } catch (e) {
      // Fallback if LLM doesn't return valid JSON
      return {
        original: question,
        subQuestions: [
          `What is ${question}?`,
          `What are the key aspects of ${question}?`,
          `What are examples of ${question}?`,
        ],
        scope: [],
        outOfScope: [],
      };
    }
  }

  // ==========================================================================
  // ACTION PLANNING
  // ==========================================================================

  private async planNextAction(workspace: Workspace): Promise<{ thought: string; action: ResearchAction }> {
    const prompt = PROMPTS.planNextAction(workspace);
    const response = await this.llm.complete(prompt);

    try {
      const parsed = JSON.parse(this.extractJSON(response));
      return {
        thought: parsed.thought,
        action: parsed.action as ResearchAction,
      };
    } catch (e) {
      // Fallback: search for the first open question
      const query = workspace.openQuestions[0] || workspace.question.original;
      return {
        thought: 'Fallback: searching for open question',
        action: { type: 'search_web', query },
      };
    }
  }

  // ==========================================================================
  // ACTION EXECUTION
  // ==========================================================================

  private async executeAction(action: ResearchAction, workspace: Workspace): Promise<string> {
    this.emit('action_started', { action });

    switch (action.type) {
      case 'search_web': {
        const results = await this.adapter.webSearch(action.query, this.config.maxSourcesPerQuery);

        // Add citations
        for (const result of results) {
          const content = await this.adapter.fetchContent(result.url) || result.snippet;
          workspace.citations.push({
            id: `cite-${workspace.citations.length + 1}`,
            url: result.url,
            title: result.title,
            content: content?.substring(0, 3000) || '',
            claimSupported: '',
            verified: false,
          });
        }

        return `Found ${results.length} web results:\n${results.map(r => `- ${r.title}: ${r.snippet}`).join('\n')}`;
      }

      case 'search_repos': {
        const repos = await this.adapter.searchRepos(action.query, this.config.maxSourcesPerQuery);

        for (const repo of repos) {
          const readme = await this.adapter.fetchReadme(repo.fullName);
          workspace.citations.push({
            id: `cite-${workspace.citations.length + 1}`,
            url: repo.url,
            title: `${repo.fullName} (${repo.stars} stars)`,
            content: readme?.substring(0, 3000) || repo.description,
            claimSupported: '',
            verified: false,
          });
        }

        return `Found ${repos.length} repositories:\n${repos.map(r => `- ${r.fullName}: ${r.description} (${r.stars} stars)`).join('\n')}`;
      }

      case 'search_papers': {
        const papers = await this.adapter.searchArxiv(action.query, 3);

        for (const paper of papers) {
          workspace.citations.push({
            id: `cite-${workspace.citations.length + 1}`,
            url: paper.url,
            title: paper.title,
            content: paper.abstract,
            claimSupported: '',
            verified: false,
          });
        }

        return `Found ${papers.length} papers:\n${papers.map(p => `- ${p.title} by ${p.authors.slice(0, 2).join(', ')}`).join('\n')}`;
      }

      case 'read_url': {
        const content = await this.adapter.fetchContent(action.url);
        return content ? `Content from ${action.url}:\n${content.substring(0, 3000)}` : `Failed to fetch ${action.url}`;
      }

      case 'synthesize': {
        return `Synthesis focus: ${action.focus}. Current understanding will be updated.`;
      }

      case 'verify_citation': {
        const verified = await this.verifySingleCitation(action.citation);
        return `Citation verification: ${verified ? 'VERIFIED' : 'UNVERIFIED'}`;
      }

      case 'ask_subquestion': {
        workspace.openQuestions.push(action.question);
        return `Added sub-question: ${action.question}`;
      }

      case 'conclude': {
        return `Concluding research: ${action.summary}`;
      }

      default:
        return 'Unknown action type';
    }
  }

  // ==========================================================================
  // SYNTHESIS
  // ==========================================================================

  private async synthesizeFindings(workspace: Workspace, newObservation: string): Promise<string> {
    const prompt = PROMPTS.synthesize(workspace, newObservation);
    const response = await this.llm.complete(prompt, { maxTokens: 1000 });

    // Update answered/open questions based on synthesis
    this.updateQuestionStatus(workspace, response);

    return response;
  }

  private updateQuestionStatus(workspace: Workspace, synthesis: string): void {
    const synthLower = synthesis.toLowerCase();

    // Move questions from open to answered if synthesis addresses them
    workspace.openQuestions = workspace.openQuestions.filter(q => {
      const keywords = q.toLowerCase().split(' ').filter(w => w.length > 4);
      const addressed = keywords.some(k => synthLower.includes(k));
      if (addressed) {
        workspace.answeredQuestions.push(q);
        return false;
      }
      return true;
    });
  }

  // ==========================================================================
  // SELF-REFLECTION (Step-DeepResearch error-reflection loop)
  // ==========================================================================

  private async reflectOnStep(step: ResearchStep, workspace: Workspace): Promise<ReflectionResult> {
    // Quick heuristic check before calling LLM
    const observationLength = step.observation?.length || 0;
    const hasResults = observationLength > 100;
    const hasError = step.observation?.toLowerCase().includes('error') ||
                     step.observation?.toLowerCase().includes('failed') ||
                     step.observation?.toLowerCase().includes('found 0');

    // If clearly successful, skip LLM reflection
    if (hasResults && !hasError) {
      return { success: true, shouldRetry: false };
    }

    // If clearly failed and action was search, suggest query modification
    if (hasError || observationLength < 50) {
      const action = step.action as any;
      if (action.type === 'search_web' || action.type === 'search_repos') {
        const query = action.query || '';
        // Try simplifying the query
        const simplifiedQuery = this.simplifyQuery(query);
        if (simplifiedQuery !== query) {
          return {
            success: false,
            issue: 'Search returned poor results',
            suggestion: `Try simplified query: "${simplifiedQuery}"`,
            shouldRetry: true,
            modifiedAction: { type: action.type, query: simplifiedQuery },
          };
        }
      }
      return { success: false, issue: 'No useful results', shouldRetry: false };
    }

    // For ambiguous cases, use LLM reflection
    try {
      const prompt = PROMPTS.reflectOnStep(step, workspace);
      const response = await this.llm.complete(prompt);
      const parsed = JSON.parse(this.extractJSON(response));
      return {
        success: parsed.success ?? true,
        issue: parsed.issue,
        suggestion: parsed.suggestion,
        shouldRetry: parsed.shouldRetry ?? false,
        modifiedAction: parsed.modifiedAction,
      };
    } catch (e) {
      // Default to successful if LLM fails
      return { success: true, shouldRetry: false };
    }
  }

  private simplifyQuery(query: string): string {
    // Remove question words and simplify
    const simplified = query
      .replace(/\b(what|how|why|when|where|which|who|is|are|do|does|can|could|would|should)\b/gi, '')
      .replace(/[?.,!]/g, '')
      .trim()
      .split(/\s+/)
      .filter(w => w.length > 3)
      .slice(0, 4)
      .join(' ');
    return simplified || query;
  }

  private trackReflection(iteration: number, reflection: ReflectionResult): void {
    const history = this.reflectionHistory.get(iteration) || [];
    history.push(reflection);
    this.reflectionHistory.set(iteration, history);
  }

  // ==========================================================================
  // CROSS-VALIDATION (multi-source verification)
  // ==========================================================================

  private async crossValidateClaims(workspace: Workspace): Promise<void> {
    this.emit('cross_validation_started', { citationCount: workspace.citations.length });

    // Group citations by topic/claim they support
    const claimGroups = this.groupCitationsByClaim(workspace);

    for (const [claim, sources] of claimGroups) {
      if (sources.length >= this.config.crossValidationThreshold) {
        const validation = await this.validateClaimAcrossSources(claim, sources);
        this.validatedClaims.push(validation);

        // Boost confidence if claim is well-validated
        if (validation.validationScore > 0.8) {
          workspace.confidence = Math.min(1, workspace.confidence + 0.05);
        }

        // Log conflicts for investigation
        if (validation.conflicts.length > 0) {
          this.emit('conflict_detected', { claim, conflicts: validation.conflicts });
        }
      }
    }

    this.emit('cross_validation_completed', {
      claimsValidated: this.validatedClaims.length,
      averageScore: this.validatedClaims.reduce((s, c) => s + c.validationScore, 0) / Math.max(1, this.validatedClaims.length),
    });
  }

  private groupCitationsByClaim(workspace: Workspace): Map<string, Citation[]> {
    const groups = new Map<string, Citation[]>();

    // Extract key topics from synthesis and group citations
    const topics = this.extractKeyTopics(workspace.synthesis);

    for (const topic of topics) {
      const relevantCitations = workspace.citations.filter(c =>
        c.content.toLowerCase().includes(topic.toLowerCase()) ||
        c.title.toLowerCase().includes(topic.toLowerCase())
      );
      if (relevantCitations.length >= 2) {
        groups.set(topic, relevantCitations);
      }
    }

    return groups;
  }

  private extractKeyTopics(synthesis: string): string[] {
    // Extract noun phrases and key terms from synthesis
    const words = synthesis.split(/\s+/);
    const topics: string[] = [];

    // Look for capitalized terms (proper nouns, acronyms)
    const capitalizedPattern = /\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*\b/g;
    const capitalized = synthesis.match(capitalizedPattern) || [];
    topics.push(...capitalized.slice(0, 5));

    // Look for technical terms in quotes
    const quotedPattern = /"([^"]+)"|'([^']+)'/g;
    let match;
    while ((match = quotedPattern.exec(synthesis)) !== null) {
      topics.push(match[1] || match[2]);
    }

    return [...new Set(topics)];
  }

  private async validateClaimAcrossSources(claim: string, sources: Citation[]): Promise<ValidatedClaim> {
    try {
      const prompt = PROMPTS.crossValidate(claim, sources);
      const response = await this.llm.complete(prompt);
      const parsed = JSON.parse(this.extractJSON(response));

      return {
        claim,
        sources,
        validationScore: parsed.validationScore ?? 0.5,
        conflicts: parsed.conflicts ?? [],
      };
    } catch (e) {
      // Default validation based on source count
      return {
        claim,
        sources,
        validationScore: Math.min(1, sources.length * 0.2),
        conflicts: [],
      };
    }
  }

  // ==========================================================================
  // AUTHORITY-AWARE SOURCE RANKING
  // ==========================================================================

  private getAuthorityScore(url: string): number {
    if (!this.config.authorityBoostEnabled) return 0.5;

    try {
      const domain = new URL(url).hostname.replace('www.', '');
      // Check for exact match
      if (AUTHORITY_DOMAINS[domain]) return AUTHORITY_DOMAINS[domain];
      // Check for partial match (e.g., medium.com/airbnb-engineering)
      for (const [authorityDomain, score] of Object.entries(AUTHORITY_DOMAINS)) {
        if (url.includes(authorityDomain)) return score;
      }
      return AUTHORITY_DOMAINS['default'];
    } catch {
      return AUTHORITY_DOMAINS['default'];
    }
  }

  private rankCitationsByAuthority(citations: Citation[]): Citation[] {
    return [...citations].sort((a, b) => {
      const scoreA = this.getAuthorityScore(a.url);
      const scoreB = this.getAuthorityScore(b.url);
      return scoreB - scoreA;
    });
  }

  // ==========================================================================
  // PARALLEL EXPLORATION (multi-agent concurrent research)
  // ==========================================================================

  /**
   * Research with parallel exploration of sub-questions
   * Based on WebSeer and Tongyi parallel architecture
   */
  async researchParallel(question: string): Promise<ResearchReport> {
    if (!this.config.enableParallelMode) {
      return this.research(question);
    }

    const startTime = Date.now();
    this.emit('parallel_research_started', { question, agents: this.config.parallelAgents });

    // Step 1: Clarify and decompose question
    const clarifiedQuestion = await this.clarifyQuestion(question);
    const subQuestions = clarifiedQuestion.subQuestions.slice(0, this.config.parallelAgents);

    // Step 2: Create parallel workers for sub-questions
    const workerPromises = subQuestions.map(async (subQ, idx) => {
      this.emit('parallel_worker_started', { index: idx, question: subQ });

      // Each worker gets limited steps
      const workerConfig = {
        ...this.config,
        maxSteps: Math.floor(this.config.maxSteps / this.config.parallelAgents),
        enableParallelMode: false, // Prevent recursive parallelization
      };

      const worker = new LLMDeepResearch(this.llm, workerConfig);

      // Forward events from worker
      worker.on('step_completed', (data) => {
        this.emit('parallel_step_completed', { workerId: idx, ...data });
      });

      try {
        const report = await worker.research(subQ);
        return { index: idx, success: true, report };
      } catch (error) {
        return { index: idx, success: false, error: String(error) };
      }
    });

    // Step 3: Wait for all workers
    const results = await Promise.all(workerPromises);
    this.emit('parallel_workers_completed', { results: results.map(r => ({ index: r.index, success: r.success })) });

    // Step 4: Merge findings
    const mergedWorkspace = this.mergeParallelResults(question, clarifiedQuestion, results);

    // Step 5: Synthesize merged findings
    const finalSynthesis = await this.synthesizeMergedFindings(mergedWorkspace);
    mergedWorkspace.synthesis = finalSynthesis;

    // Step 6: Cross-validate merged claims
    if (this.config.enableCrossValidation) {
      await this.crossValidateClaims(mergedWorkspace);
    }

    // Step 7: Generate unified report
    const report = await this.generateReport(mergedWorkspace, []);

    report.metadata = {
      stepsExecuted: results.reduce((sum, r) => sum + (r.success && r.report ? r.report.metadata.stepsExecuted : 0), 0),
      sourcesConsulted: mergedWorkspace.citations.length,
      timeElapsed: Date.now() - startTime,
      tokensUsed: results.reduce((sum, r) => sum + (r.success && r.report ? r.report.metadata.tokensUsed : 0), 0),
    };

    this.emit('parallel_research_completed', { report });
    return report;
  }

  private mergeParallelResults(
    originalQuestion: string,
    clarifiedQuestion: ResearchQuestion,
    results: Array<{ index: number; success: boolean; report?: ResearchReport; error?: string }>
  ): Workspace {
    const mergedCitations: Citation[] = [];
    const answeredQuestions: string[] = [];
    const openQuestions: string[] = [];
    let combinedSynthesis = '';

    for (const result of results) {
      if (result.success && result.report) {
        // Merge citations (with deduplication)
        for (const citation of result.report.citations) {
          const exists = mergedCitations.some(c => c.url === citation.url);
          if (!exists) {
            mergedCitations.push(citation);
          }
        }

        // Merge answered questions
        const subQ = clarifiedQuestion.subQuestions[result.index];
        if (result.report.confidence > 0.5) {
          answeredQuestions.push(subQ);
        } else {
          openQuestions.push(subQ);
        }

        // Append to combined synthesis
        combinedSynthesis += `\n\n## ${subQ}\n${result.report.executiveSummary}`;
      } else {
        // Mark failed sub-question as open
        const subQ = clarifiedQuestion.subQuestions[result.index];
        openQuestions.push(subQ);
      }
    }

    // Rank citations by authority
    const rankedCitations = this.rankCitationsByAuthority(mergedCitations);

    return {
      question: { ...clarifiedQuestion, original: originalQuestion },
      synthesis: combinedSynthesis,
      lastStep: null,
      citations: rankedCitations,
      openQuestions,
      answeredQuestions,
      confidence: answeredQuestions.length / Math.max(1, clarifiedQuestion.subQuestions.length),
      iteration: 0,
    };
  }

  private async synthesizeMergedFindings(workspace: Workspace): Promise<string> {
    const prompt = `You are synthesizing findings from multiple parallel research streams.

ORIGINAL QUESTION: ${workspace.question.original}

PARALLEL FINDINGS:
${workspace.synthesis}

SOURCES GATHERED: ${workspace.citations.length}
QUESTIONS ANSWERED: ${workspace.answeredQuestions.join(', ')}
QUESTIONS REMAINING: ${workspace.openQuestions.join(', ')}

Create a unified synthesis that:
1. Integrates insights from all research streams
2. Identifies common themes and patterns
3. Notes any contradictions or gaps
4. Provides a coherent narrative answering the original question

Write a comprehensive synthesis (500-800 words).`;

    return this.llm.complete(prompt, { maxTokens: 1500 });
  }

  // ==========================================================================
  // CITATION VERIFICATION
  // ==========================================================================

  private async verifyCitations(workspace: Workspace): Promise<void> {
    this.emit('verification_started', { count: workspace.citations.length });

    for (const citation of workspace.citations) {
      if (!citation.verified && citation.claimSupported) {
        citation.verified = await this.verifySingleCitation(citation);
      }
    }

    this.emit('verification_completed', {
      total: workspace.citations.length,
      verified: workspace.citations.filter(c => c.verified).length,
    });
  }

  private async verifySingleCitation(citation: Citation): Promise<boolean> {
    if (!citation.claimSupported || !citation.content) {
      return false;
    }

    const prompt = PROMPTS.verifyCitation(citation);
    const response = await this.llm.complete(prompt);

    try {
      const parsed = JSON.parse(this.extractJSON(response));
      citation.verified = parsed.verified;
      citation.verificationNote = parsed.explanation;
      return parsed.verified;
    } catch (e) {
      return false;
    }
  }

  // ==========================================================================
  // REPORT GENERATION
  // ==========================================================================

  private async generateReport(workspace: Workspace, steps: ResearchStep[]): Promise<ResearchReport> {
    const prompt = PROMPTS.generateReport(workspace, steps);
    const response = await this.llm.complete(prompt, { maxTokens: 2000 });

    try {
      const parsed = JSON.parse(this.extractJSON(response));

      return {
        id: `report-${Date.now()}`,
        question: workspace.question.original,
        executiveSummary: parsed.executiveSummary,
        sections: parsed.sections || [],
        citations: workspace.citations,
        methodology: parsed.methodology || 'Iterative web research with LLM-guided exploration',
        limitations: parsed.limitations || [],
        recommendations: parsed.recommendations || [],
        confidence: workspace.confidence,
        metadata: {
          stepsExecuted: steps.length,
          sourcesConsulted: workspace.citations.length,
          timeElapsed: 0,
          tokensUsed: 0,
        },
      };
    } catch (e) {
      // Fallback report
      return {
        id: `report-${Date.now()}`,
        question: workspace.question.original,
        executiveSummary: workspace.synthesis,
        sections: [{
          title: 'Findings',
          content: workspace.synthesis,
          citations: workspace.citations.map(c => c.id),
        }],
        citations: workspace.citations,
        methodology: 'Iterative web research',
        limitations: ['Report generation encountered an error'],
        recommendations: workspace.openQuestions.map(q => `Investigate: ${q}`),
        confidence: workspace.confidence,
        metadata: {
          stepsExecuted: steps.length,
          sourcesConsulted: workspace.citations.length,
          timeElapsed: 0,
          tokensUsed: 0,
        },
      };
    }
  }

  // ==========================================================================
  // CONFIDENCE ESTIMATION
  // ==========================================================================

  private estimateConfidence(workspace: Workspace): number {
    const factors = {
      // How many sub-questions answered?
      questionCoverage: workspace.answeredQuestions.length /
        Math.max(1, workspace.answeredQuestions.length + workspace.openQuestions.length),

      // How many citations do we have?
      citationCount: Math.min(1, workspace.citations.length / 10),

      // How verified are citations?
      citationQuality: workspace.citations.length > 0
        ? workspace.citations.filter(c => c.verified).length / workspace.citations.length
        : 0,

      // Synthesis length (proxy for depth)
      synthesisDepth: Math.min(1, workspace.synthesis.length / 2000),
    };

    return (
      factors.questionCoverage * 0.4 +
      factors.citationCount * 0.2 +
      factors.citationQuality * 0.2 +
      factors.synthesisDepth * 0.2
    );
  }

  // ==========================================================================
  // UTILITIES
  // ==========================================================================

  private extractJSON(text: string): string {
    // Find JSON in response (handle markdown code blocks)
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) ||
                      text.match(/(\{[\s\S]*\})/);
    return jsonMatch ? jsonMatch[1].trim() : text;
  }
}

// ============================================================================
// MOCK LLM PROVIDER (for testing without API)
// ============================================================================

/**
 * Smart rule-based LLM provider that works without API
 * Uses heuristics to simulate intelligent research planning
 */
export class SmartRuleBasedProvider implements LLMProvider {
  name = 'smart-rules';
  private actionHistory: string[] = [];
  private iteration = 0;

  async complete(prompt: string): Promise<string> {
    // Extract context from prompt
    const questionMatch = prompt.match(/ORIGINAL QUESTION: (.+)/);
    const question = questionMatch ? questionMatch[1] : '';

    const synthesisMatch = prompt.match(/CURRENT SYNTHESIS:\n([\s\S]*?)(?=LAST STEP:|$)/);
    const currentSynthesis = synthesisMatch ? synthesisMatch[1].trim() : '';

    const openQuestionsMatch = prompt.match(/OPEN QUESTIONS: (.+)/);
    const openQuestions = openQuestionsMatch ? openQuestionsMatch[1].split(', ') : [];

    const iterationMatch = prompt.match(/ITERATION: (\d+)/);
    this.iteration = iterationMatch ? parseInt(iterationMatch[1]) : 0;

    const confidenceMatch = prompt.match(/CONFIDENCE: (\d+)%/);
    const confidence = confidenceMatch ? parseInt(confidenceMatch[1]) : 0;

    const citationsMatch = prompt.match(/CITATIONS SO FAR: (\d+)/);
    const citationCount = citationsMatch ? parseInt(citationsMatch[1]) : 0;

    // Clarification prompt
    if (prompt.includes('clarify it and break it into sub-questions')) {
      const topic = question || prompt.match(/QUESTION: (.+)/)?.[1] || 'the topic';
      return JSON.stringify({
        clarified: topic,
        subQuestions: [
          `What is ${topic} and what problem does it solve?`,
          `What are the key components and architecture of ${topic}?`,
          `What are real-world examples and implementations of ${topic}?`,
          `What are the advantages and disadvantages of ${topic}?`,
          `How does ${topic} compare to alternatives?`,
        ],
        scope: [topic, 'implementation patterns', 'use cases', 'best practices'],
        outOfScope: ['unrelated technologies', 'historical context beyond 2020'],
      });
    }

    // Action planning prompt
    if (prompt.includes('decide what to do next')) {
      return this.planNextAction(question, currentSynthesis, openQuestions, confidence, citationCount);
    }

    // Synthesis prompt
    if (prompt.includes('synthesizing research findings')) {
      return this.synthesizeFindings(prompt, currentSynthesis);
    }

    // Report generation
    if (prompt.includes('Generate a comprehensive research report')) {
      return this.generateReport(prompt, currentSynthesis);
    }

    // Citation verification
    if (prompt.includes('Verify if this source supports')) {
      return JSON.stringify({
        verified: true,
        explanation: 'Source content appears relevant to the claim',
        actualSupport: 'The source discusses related concepts',
      });
    }

    return '{}';
  }

  /**
   * Extract keywords from a question for better search results
   */
  private extractKeywords(text: string): string {
    // Remove common question words and stop words
    const stopWords = ['what', 'is', 'how', 'do', 'does', 'are', 'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'for', 'with', 'companies', 'implement', 'use', 'using'];
    const words = text.toLowerCase()
      .replace(/[?.,!]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.includes(w));
    return words.slice(0, 5).join(' ');
  }

  private planNextAction(
    question: string,
    synthesis: string,
    openQuestions: string[],
    confidence: number,
    citationCount: number
  ): string {
    // Decide action based on research state
    let action: ResearchAction;
    let thought: string;

    // Extract keywords for better search
    const keywords = this.extractKeywords(question);

    if (this.iteration === 1) {
      // First step: search for the main topic keywords
      thought = `Starting research on "${question}". Searching for keywords: "${keywords}"`;
      action = { type: 'search_web', query: keywords };
      this.actionHistory.push('search_web:' + keywords);
    } else if (this.iteration === 2) {
      // Second step: search GitHub for implementations
      thought = 'Now searching for code implementations and repositories to understand practical applications.';
      action = { type: 'search_repos', query: keywords };
      this.actionHistory.push('search_repos:' + keywords);
    } else if (openQuestions.length > 0 && this.iteration <= 5) {
      // Address open questions
      const nextQ = openQuestions[0].replace(/\?$/, '');
      thought = `Investigating open question: "${nextQ}"`;
      action = { type: 'search_web', query: nextQ };
      this.actionHistory.push('search_web:' + nextQ);
    } else if (citationCount >= 5 && !this.actionHistory.includes('synthesize')) {
      // Have enough sources, synthesize
      thought = 'Have gathered sufficient sources. Consolidating findings into coherent synthesis.';
      action = { type: 'synthesize', focus: 'consolidate all findings' };
      this.actionHistory.push('synthesize');
    } else if (confidence >= 50 || this.iteration >= 8) {
      // Ready to conclude
      thought = `Confidence is ${confidence}% with ${citationCount} citations. Ready to conclude research.`;
      action = { type: 'conclude', summary: 'Research complete with comprehensive findings.' };
    } else {
      // Continue exploring
      const searchTerms = [
        question + ' tutorial',
        question + ' best practices',
        question + ' architecture',
        question + ' implementation guide',
      ];
      const termIndex = (this.iteration - 3) % searchTerms.length;
      thought = `Continuing exploration with related search: "${searchTerms[termIndex]}"`;
      action = { type: 'search_web', query: searchTerms[termIndex] };
      this.actionHistory.push('search_web:' + searchTerms[termIndex]);
    }

    return JSON.stringify({ thought, action });
  }

  private synthesizeFindings(prompt: string, currentSynthesis: string): string {
    const newInfoMatch = prompt.match(/NEW INFORMATION:\n([\s\S]*?)$/);
    const newInfo = newInfoMatch ? newInfoMatch[1].trim() : '';

    // Extract key points from new info
    const sentences = newInfo.split(/[.!?]+/).filter(s => s.trim().length > 20);
    const keyPoints = sentences.slice(0, 5).map(s => s.trim());

    const synthesis = `${currentSynthesis}

## New Findings

${keyPoints.map(p => `- ${p}`).join('\n')}

## Updated Understanding

Based on the gathered sources, we now have a clearer picture of the topic. The research has uncovered:
1. Key definitions and concepts from authoritative sources
2. Implementation patterns from real-world projects
3. Best practices recommended by practitioners

More investigation may be needed to fully address all sub-questions.`;

    return synthesis;
  }

  private generateReport(prompt: string, synthesis: string): string {
    const questionMatch = prompt.match(/QUESTION: (.+)/);
    const question = questionMatch ? questionMatch[1] : 'Research topic';

    return JSON.stringify({
      executiveSummary: `This research investigated "${question}" through systematic web and repository analysis. Key findings include identification of major frameworks, implementation patterns, and best practices. ${synthesis.substring(0, 300)}`,
      sections: [
        {
          title: 'Overview',
          content: 'This section provides an overview of the topic based on gathered sources.',
          citations: ['cite-1', 'cite-2'],
        },
        {
          title: 'Implementation Patterns',
          content: 'Analysis of how the technology is implemented in practice, based on GitHub repositories and technical articles.',
          citations: ['cite-3', 'cite-4'],
        },
        {
          title: 'Best Practices',
          content: 'Recommended approaches based on industry experience and documentation.',
          citations: ['cite-5'],
        },
      ],
      methodology: 'Iterative web research using search engines and GitHub, with synthesis at each step',
      limitations: [
        'Limited to publicly available sources',
        'No access to proprietary implementations',
        'Synthesis performed without LLM verification',
      ],
      recommendations: [
        'Review the top-starred repositories for implementation examples',
        'Consider the trade-offs discussed in the analysis',
        'Test with a small proof-of-concept before full adoption',
      ],
    });
  }
}

// Singleton instance for SmartRuleBasedProvider to maintain state across calls
let smartRuleBasedInstance: SmartRuleBasedProvider | null = null;

export class MockLLMProvider implements LLMProvider {
  name = 'mock';

  async complete(prompt: string): Promise<string> {
    // Use singleton to maintain state across calls
    if (!smartRuleBasedInstance) {
      smartRuleBasedInstance = new SmartRuleBasedProvider();
    }
    return smartRuleBasedInstance.complete(prompt);
  }
}

/**
 * Reset the smart provider state (useful for testing)
 */
export function resetSmartProvider(): void {
  smartRuleBasedInstance = null;
}

// ============================================================================
// OLLAMA LLM PROVIDER
// ============================================================================

export class OllamaLLMProvider implements LLMProvider {
  name = 'ollama';
  private baseUrl: string;
  private model: string;

  constructor(model: string = 'qwen3:4b', baseUrl: string = 'http://127.0.0.1:11434') {
    this.model = model;
    this.baseUrl = baseUrl;
  }

  async complete(prompt: string, options: { maxTokens?: number; temperature?: number } = {}): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: prompt,
        stream: false,
        options: {
          num_predict: options.maxTokens || 1024,
          temperature: options.temperature || 0.7,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }

    const data = await response.json();
    return data.response || '';
  }
}

// ============================================================================
// OPENROUTER LLM PROVIDER (supports many models, has free tier)
// ============================================================================

export class OpenRouterLLMProvider implements LLMProvider {
  name = 'openrouter';
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string = 'meta-llama/llama-3.2-3b-instruct:free') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async complete(prompt: string, options: { maxTokens?: number; temperature?: number } = {}): Promise<string> {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'HTTP-Referer': 'https://ronald-gi.local',
        'X-Title': 'Ronald-GI Research',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: options.maxTokens || 1024,
        temperature: options.temperature || 0.7,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  }
}

// ============================================================================
// ANTHROPIC LLM PROVIDER
// ============================================================================

export class AnthropicLLMProvider implements LLMProvider {
  name = 'anthropic';
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string = 'claude-sonnet-4-20250514') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async complete(prompt: string, options: { maxTokens?: number; temperature?: number } = {}): Promise<string> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: options.maxTokens || 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status}`);
    }

    const data = await response.json();
    return data.content[0]?.text || '';
  }
}

// ============================================================================
// CLI TEST
// ============================================================================

import { fileURLToPath } from 'url';

const isMainModule = process.argv[1] && (
  process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1].includes('llm_deep_research')
);

if (isMainModule) {
  const question = process.argv[2] || 'What is Server Driven UI (SDUI) and how do companies like Airbnb implement it?';

  // Auto-select LLM provider based on available API keys
  let llm: LLMProvider;

  if (process.env.OPENROUTER_API_KEY) {
    console.log('Using OpenRouter (fast, cloud-based)...\n');
    llm = new OpenRouterLLMProvider(process.env.OPENROUTER_API_KEY);
  } else if (process.env.ANTHROPIC_API_KEY) {
    console.log('Using Anthropic Claude (fast, cloud-based)...\n');
    llm = new AnthropicLLMProvider(process.env.ANTHROPIC_API_KEY);
  } else {
    console.log('Using smart rule-based provider (no API key found)...');
    console.log('For better results, set OPENROUTER_API_KEY or ANTHROPIC_API_KEY\n');
    llm = new SmartRuleBasedProvider();
  }

  const engine = new LLMDeepResearch(llm, {
    maxSteps: 10,
    maxSourcesPerQuery: 5,
    minConfidenceToStop: 0.7,
  });

  engine.on('research_started', ({ question }) => {
    console.log(`\n🔬 Starting research: "${question}"\n`);
  });

  engine.on('iteration_started', ({ iteration }) => {
    console.log(`📍 Step ${iteration}`);
  });

  engine.on('action_started', ({ action }) => {
    console.log(`   Action: ${action.type}`);
  });

  engine.on('step_completed', ({ step, workspace }) => {
    console.log(`   Thought: ${step.thought.substring(0, 80)}...`);
    console.log(`   Confidence: ${(workspace.confidence * 100).toFixed(0)}%`);
  });

  engine.on('research_completed', ({ report }) => {
    console.log('\n' + '='.repeat(60));
    console.log('RESEARCH REPORT');
    console.log('='.repeat(60));
    console.log(`\nQuestion: ${report.question}`);
    console.log(`\n## Executive Summary\n${report.executiveSummary}`);
    console.log(`\n## Sources (${report.citations.length})`);
    report.citations.slice(0, 5).forEach(c => console.log(`  - ${c.title}`));
    console.log(`\n## Recommendations`);
    report.recommendations.forEach(r => console.log(`  - ${r}`));
    console.log(`\nMetadata: ${report.metadata.stepsExecuted} steps, ${report.metadata.sourcesConsulted} sources`);
  });

  engine.research(question).catch(console.error);
}
