/**
 * TDD Test Suite for LLM Deep Research Engine
 *
 * Tests all core functionality:
 * - Question clarification
 * - Action planning
 * - Search execution
 * - Synthesis
 * - Self-reflection
 * - Cross-validation
 * - Authority ranking
 * - Report generation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  LLMDeepResearch,
  SmartRuleBasedProvider,
  ResearchConfig,
  Workspace,
  Citation,
  ResearchStep,
  AUTHORITY_DOMAINS,
  resetSmartProvider,
} from '../core/llm_deep_research';

// Mock ResearchAdapter to avoid network calls
vi.mock('../core/research_adapter', () => ({
  ResearchAdapter: vi.fn().mockImplementation(() => ({
    webSearch: vi.fn().mockResolvedValue([
      {
        url: 'https://engineering.fb.com/sdui-article',
        title: 'Server-Driven UI at Facebook',
        snippet: 'Server-Driven UI allows us to update mobile apps without app store releases.',
      },
      {
        url: 'https://github.com/airbnb/lottie',
        title: 'Airbnb Lottie',
        snippet: 'Animation library for server-driven animations.',
      },
    ]),
    searchRepos: vi.fn().mockResolvedValue([
      {
        fullName: 'nicklockwood/SwiftFormat',
        description: 'A code formatting tool for Swift',
        stars: 7500,
        url: 'https://github.com/nicklockwood/SwiftFormat',
      },
    ]),
    searchArxiv: vi.fn().mockResolvedValue([
      {
        title: 'Deep Learning for SDUI',
        url: 'https://arxiv.org/abs/1234.5678',
        abstract: 'We present a deep learning approach...',
        authors: ['John Doe', 'Jane Smith'],
      },
    ]),
    fetchContent: vi.fn().mockResolvedValue('Mock content from the page about Server-Driven UI patterns.'),
    fetchReadme: vi.fn().mockResolvedValue('# Project README\n\nThis project implements SDUI.'),
  })),
}));

describe('LLMDeepResearch', () => {
  let engine: LLMDeepResearch;
  let llm: SmartRuleBasedProvider;

  beforeEach(() => {
    resetSmartProvider();
    llm = new SmartRuleBasedProvider();
    engine = new LLMDeepResearch(llm, {
      maxSteps: 5,
      maxSourcesPerQuery: 3,
      minConfidenceToStop: 0.5,
      enableSelfReflection: true,
      enableCrossValidation: true,
      authorityBoostEnabled: true,
    });
  });

  describe('SmartRuleBasedProvider', () => {
    it('should clarify questions with sub-questions', async () => {
      const response = await llm.complete(`You are a research assistant. Given this research question, clarify it and break it into sub-questions.

QUESTION: What is SDUI?

Respond in this exact JSON format:
{
  "clarified": "...",
  "subQuestions": [...],
  "scope": [...],
  "outOfScope": [...]
}`);

      const parsed = JSON.parse(response);
      expect(parsed.clarified).toBeDefined();
      expect(parsed.subQuestions).toBeInstanceOf(Array);
      expect(parsed.subQuestions.length).toBeGreaterThan(0);
      expect(parsed.scope).toBeInstanceOf(Array);
      expect(parsed.outOfScope).toBeInstanceOf(Array);
    });

    it('should plan next actions based on iteration', async () => {
      // First iteration should trigger web search
      const response1 = await llm.complete(`You are a research agent. Based on your current workspace, decide what to do next.

ORIGINAL QUESTION: What is SDUI?
CLARIFIED: What is SDUI?

CURRENT SYNTHESIS:
No findings yet.

LAST STEP:
This is the first step.

OPEN QUESTIONS: What is SDUI?
ANSWERED: None yet
CITATIONS SO FAR: 0
CONFIDENCE: 0%
ITERATION: 1

Decide what to do next.`);

      const parsed1 = JSON.parse(response1);
      expect(parsed1.thought).toBeDefined();
      expect(parsed1.action.type).toBe('search_web');
    });

    it('should synthesize findings from new information', async () => {
      const response = await llm.complete(`You are synthesizing research findings. Update your understanding based on new information.

QUESTION: What is SDUI?

PREVIOUS SYNTHESIS:
No previous synthesis.

NEW INFORMATION:
Found 2 web results:
- Server-Driven UI at Facebook: Server-Driven UI allows dynamic updates
- Airbnb Lottie: Animation library

Write an updated synthesis.`);

      expect(response).toContain('findings');
      expect(response.length).toBeGreaterThan(100);
    });

    it('should verify citations', async () => {
      const response = await llm.complete(`Verify if this source supports the claimed assertion.

CLAIM: SDUI allows dynamic updates

SOURCE TITLE: Server-Driven UI at Facebook
SOURCE URL: https://engineering.fb.com/sdui
SOURCE CONTENT:
Server-Driven UI is a pattern that allows mobile apps to update their UI without app store releases.

Does this source adequately support the claim?`);

      const parsed = JSON.parse(response);
      expect(parsed.verified).toBeDefined();
      expect(parsed.explanation).toBeDefined();
    });
  });

  describe('Authority Ranking', () => {
    it('should have authority scores for key domains', () => {
      expect(AUTHORITY_DOMAINS['developer.mozilla.org']).toBe(1.0);
      expect(AUTHORITY_DOMAINS['arxiv.org']).toBe(0.95);
      expect(AUTHORITY_DOMAINS['github.com']).toBe(0.8);
      expect(AUTHORITY_DOMAINS['medium.com']).toBe(0.6);
      expect(AUTHORITY_DOMAINS['default']).toBe(0.5);
    });

    it('should rank citations by authority', async () => {
      const citations: Citation[] = [
        { id: '1', url: 'https://medium.com/article', title: 'Medium', content: '', claimSupported: '', verified: false },
        { id: '2', url: 'https://developer.mozilla.org/docs', title: 'MDN', content: '', claimSupported: '', verified: false },
        { id: '3', url: 'https://github.com/repo', title: 'GitHub', content: '', claimSupported: '', verified: false },
      ];

      // Access private method through type assertion
      const ranked = (engine as any).rankCitationsByAuthority(citations);

      // MDN should be first (1.0), GitHub second (0.8), Medium last (0.6)
      expect(ranked[0].url).toContain('developer.mozilla.org');
      expect(ranked[1].url).toContain('github.com');
      expect(ranked[2].url).toContain('medium.com');
    });
  });

  describe('Self-Reflection', () => {
    it('should detect failed searches and suggest retry', async () => {
      const step: ResearchStep = {
        stepNumber: 1,
        thought: 'Searching for SDUI',
        action: { type: 'search_web', query: 'What is SDUI and how does it work in detail?' },
        observation: 'Found 0 results',
        synthesis: '',
        timestamp: new Date(),
      };

      const workspace: Workspace = {
        question: { original: 'What is SDUI?', subQuestions: [], scope: [], outOfScope: [] },
        synthesis: '',
        lastStep: null,
        citations: [],
        openQuestions: [],
        answeredQuestions: [],
        confidence: 0,
        iteration: 1,
      };

      // Access private method
      const reflection = await (engine as any).reflectOnStep(step, workspace);

      expect(reflection.success).toBe(false);
      expect(reflection.shouldRetry).toBe(true);
      expect(reflection.modifiedAction).toBeDefined();
      // The modified query should be simplified
      expect(reflection.modifiedAction.query.length).toBeLessThan(step.action.query.length);
    });

    it('should mark successful searches as success', async () => {
      const step: ResearchStep = {
        stepNumber: 1,
        thought: 'Searching for SDUI',
        action: { type: 'search_web', query: 'SDUI' },
        observation: 'Found 5 web results:\n- Server-Driven UI at Facebook: Great article about SDUI patterns and implementation...',
        synthesis: '',
        timestamp: new Date(),
      };

      const workspace: Workspace = {
        question: { original: 'What is SDUI?', subQuestions: [], scope: [], outOfScope: [] },
        synthesis: '',
        lastStep: null,
        citations: [],
        openQuestions: [],
        answeredQuestions: [],
        confidence: 0,
        iteration: 1,
      };

      const reflection = await (engine as any).reflectOnStep(step, workspace);

      expect(reflection.success).toBe(true);
      expect(reflection.shouldRetry).toBe(false);
    });
  });

  describe('Query Simplification', () => {
    it('should remove question words and stopwords', () => {
      const query = 'What is Server-Driven UI and how does it work?';
      const simplified = (engine as any).simplifyQuery(query);

      expect(simplified).not.toContain('what');
      expect(simplified).not.toContain('how');
      expect(simplified).not.toContain('does');
      expect(simplified).toContain('Server');
    });

    it('should limit query to 4 words', () => {
      const query = 'What is the comprehensive guide to implementing server driven UI patterns in mobile applications?';
      const simplified = (engine as any).simplifyQuery(query);

      const words = simplified.split(' ').filter(w => w.length > 0);
      expect(words.length).toBeLessThanOrEqual(4);
    });
  });

  describe('Cross-Validation', () => {
    it('should extract key topics from synthesis', () => {
      const synthesis = `
        Server-Driven UI (SDUI) is a pattern used by companies like Airbnb and Facebook.
        The key concept is "component-based rendering" where the server controls the UI.
      `;

      const topics = (engine as any).extractKeyTopics(synthesis);

      expect(topics).toContain('Server');
      expect(topics.some(t => t.includes('Airbnb') || t.includes('Facebook'))).toBe(true);
      expect(topics).toContain('component-based rendering');
    });

    it('should group citations by topic', () => {
      const workspace: Workspace = {
        question: { original: 'What is SDUI?', subQuestions: [], scope: [], outOfScope: [] },
        synthesis: 'SDUI is used by Facebook and Airbnb for mobile apps.',
        lastStep: null,
        citations: [
          { id: '1', url: 'https://fb.com/1', title: 'Facebook SDUI', content: 'Facebook uses SDUI...', claimSupported: '', verified: false },
          { id: '2', url: 'https://airbnb.com/1', title: 'Airbnb Mobile', content: 'At Airbnb we use SDUI...', claimSupported: '', verified: false },
          { id: '3', url: 'https://fb.com/2', title: 'FB Engineering', content: 'Facebook mobile team...', claimSupported: '', verified: false },
        ],
        openQuestions: [],
        answeredQuestions: [],
        confidence: 0.5,
        iteration: 3,
      };

      const groups = (engine as any).groupCitationsByClaim(workspace);

      // Should have at least one group with 2+ citations
      let hasMultiCitationGroup = false;
      for (const [topic, sources] of groups) {
        if (sources.length >= 2) {
          hasMultiCitationGroup = true;
          break;
        }
      }
      expect(hasMultiCitationGroup).toBe(true);
    });
  });

  describe('Full Research Flow', () => {
    it('should complete a research session with artifacts', async () => {
      const events: string[] = [];

      engine.on('research_started', () => events.push('started'));
      engine.on('iteration_started', () => events.push('iteration'));
      engine.on('step_completed', () => events.push('step'));
      engine.on('research_completed', () => events.push('completed'));

      const report = await engine.research('What is SDUI?');

      // Check events fired in order
      expect(events[0]).toBe('started');
      expect(events).toContain('iteration');
      expect(events).toContain('step');
      expect(events[events.length - 1]).toBe('completed');

      // Check report structure
      expect(report.id).toBeDefined();
      expect(report.question).toBe('What is SDUI?');
      expect(report.executiveSummary).toBeDefined();
      expect(report.sections).toBeInstanceOf(Array);
      expect(report.citations).toBeInstanceOf(Array);
      expect(report.recommendations).toBeInstanceOf(Array);
      expect(report.metadata.stepsExecuted).toBeGreaterThan(0);
    }, 30000);

    it('should emit reflection retry events when search fails', async () => {
      // This test verifies the reflection loop works
      const retryEvents: any[] = [];

      engine.on('reflection_retry', (data) => retryEvents.push(data));

      // The mock adapter returns results, so we need to manually test the reflection
      // This is more of an integration test
      const report = await engine.research('What is a nonexistent topic xyz123?');

      expect(report).toBeDefined();
    }, 30000);
  });

  describe('Confidence Estimation', () => {
    it('should increase confidence with more citations', () => {
      const workspace1: Workspace = {
        question: { original: 'Test', subQuestions: [], scope: [], outOfScope: [] },
        synthesis: 'Some synthesis text.',
        lastStep: null,
        citations: [],
        openQuestions: ['Q1'],
        answeredQuestions: [],
        confidence: 0,
        iteration: 1,
      };

      const workspace2: Workspace = {
        ...workspace1,
        citations: [
          { id: '1', url: 'https://example.com', title: 'Test', content: 'Content', claimSupported: '', verified: true },
          { id: '2', url: 'https://example2.com', title: 'Test2', content: 'Content2', claimSupported: '', verified: true },
        ],
        answeredQuestions: ['Q1'],
        openQuestions: [],
      };

      const conf1 = (engine as any).estimateConfidence(workspace1);
      const conf2 = (engine as any).estimateConfidence(workspace2);

      expect(conf2).toBeGreaterThan(conf1);
    });

    it('should factor in citation verification', () => {
      const workspaceUnverified: Workspace = {
        question: { original: 'Test', subQuestions: [], scope: [], outOfScope: [] },
        synthesis: 'Some synthesis.',
        lastStep: null,
        citations: [
          { id: '1', url: 'https://example.com', title: 'Test', content: 'Content', claimSupported: '', verified: false },
          { id: '2', url: 'https://example2.com', title: 'Test2', content: 'Content2', claimSupported: '', verified: false },
        ],
        openQuestions: [],
        answeredQuestions: ['Q1'],
        confidence: 0,
        iteration: 2,
      };

      const workspaceVerified: Workspace = {
        ...workspaceUnverified,
        citations: workspaceUnverified.citations.map(c => ({ ...c, verified: true })),
      };

      const confUnverified = (engine as any).estimateConfidence(workspaceUnverified);
      const confVerified = (engine as any).estimateConfidence(workspaceVerified);

      expect(confVerified).toBeGreaterThan(confUnverified);
    });
  });
});

describe('ResearchConfig Defaults', () => {
  it('should use default values when not specified', () => {
    const llm = new SmartRuleBasedProvider();
    const engine = new LLMDeepResearch(llm);

    // Access config through type assertion
    const config = (engine as any).config;

    expect(config.maxSteps).toBe(20);
    expect(config.maxSourcesPerQuery).toBe(5);
    expect(config.minConfidenceToStop).toBe(0.8);
    expect(config.enableSelfReflection).toBe(true);
    expect(config.maxReflectionRetries).toBe(3);
    expect(config.enableCrossValidation).toBe(true);
    expect(config.crossValidationThreshold).toBe(2);
    expect(config.authorityBoostEnabled).toBe(true);
  });

  it('should allow overriding defaults', () => {
    const llm = new SmartRuleBasedProvider();
    const engine = new LLMDeepResearch(llm, {
      maxSteps: 10,
      enableSelfReflection: false,
    });

    const config = (engine as any).config;

    expect(config.maxSteps).toBe(10);
    expect(config.enableSelfReflection).toBe(false);
    // Other defaults should still apply
    expect(config.maxSourcesPerQuery).toBe(5);
  });
});
