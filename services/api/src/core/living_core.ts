/**
 * Living Core - The Heart of Ronald-GI
 *
 * This is not a tool. This is the LIFE of the system.
 *
 * The Living Core:
 * - Runs continuously (heartbeat loop)
 * - Receives stream of consciousness (observations)
 * - Integrates into coherent world model
 * - Evaluates and pursues rabbit holes autonomously
 * - Actually does research (web, repos, papers)
 * - Detects inconsistencies and asks smart questions
 * - Generates meaningful cards after real work
 * - Learns research patterns over time
 *
 * Based on AGI Memory's architecture:
 * - Database = Brain (SQLite)
 * - Heartbeat Worker = Conscious processing
 * - Maintenance Worker = Subconscious upkeep
 */

import Database from 'better-sqlite3';
import { EventEmitter } from 'events';
import { ResearchAdapter, SearchResult, RepoInfo, PaperInfo } from './research_adapter';

// ============================================================================
// TYPES
// ============================================================================

export type ObservationSource =
  | 'thought'       // Direct text input
  | 'clipboard'     // Clipboard watcher
  | 'browser'       // Browser history/tabs
  | 'bookmark'      // Saved bookmarks
  | 'code'          // File changes
  | 'conversation'  // Chat messages
  | 'paper'         // Ingested papers
  | 'repo';         // Analyzed repositories

export interface Observation {
  id: string;
  source: ObservationSource;
  content: string;
  timestamp: Date;
  metadata: Record<string, unknown>;
  processed: boolean;
}

export interface Concept {
  id: string;
  name: string;
  type: 'topic' | 'technology' | 'pattern' | 'person' | 'organization';
  embedding?: number[];
  createdAt: Date;
  accessCount: number;
  lastAccessed: Date;
}

export interface Belief {
  id: string;
  content: string;
  confidence: number;        // 0-1
  evidence: string[];        // IDs of supporting observations
  contradictions: string[];  // IDs of contradicting observations
  createdAt: Date;
  updatedAt: Date;
}

export interface RabbitHole {
  id: string;
  topic: string;
  concepts: string[];
  estimatedValue: number;    // How useful? 0-1
  estimatedCost: number;     // How much effort? 0-1
  suggestedDepth: 'skim' | 'read' | 'deep-dive';
  status: 'pending' | 'in_progress' | 'completed' | 'abandoned';
  createdAt: Date;
}

export interface ResearchResult {
  id: string;
  rabbitHoleId: string;
  source: string;            // URL or identifier
  sourceType: 'web' | 'repo' | 'paper' | 'code';
  content: string;
  insights: string[];
  quality: number;           // 0-1
  fetchedAt: Date;
}

export interface Card {
  id: string;
  type: 'research_brief' | 'decision_memo' | 'connection' | 'question' | 'pattern';
  title: string;
  content: string;
  concepts: string[];
  evidence: string[];        // Research result IDs
  suggestedActions: string[];
  confidence: number;
  createdAt: Date;
  surfaced: boolean;
  surfacedAt?: Date;
}

export interface Conflict {
  id: string;
  observationId: string;
  beliefId: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  resolved: boolean;
}

export interface Question {
  id: string;
  conflictId?: string;
  question: string;
  options: string[];
  importance: 'critical' | 'important' | 'nice-to-know';
  answered: boolean;
  answer?: string;
  createdAt: Date;
}

export interface HeartbeatState {
  lastBeat: Date;
  observationsProcessed: number;
  researchCompleted: number;
  cardsGenerated: number;
  questionsAsked: number;
  energyLevel: number;       // 0-1, depletes with actions
}

export interface LivingCoreConfig {
  dbPath: string;
  heartbeatIntervalMs: number;
  valueThreshold: number;    // Min value/cost ratio to pursue rabbit hole
  maxConcurrentResearch: number;
  questionCooldownMs: number;
  enableWebSearch: boolean;
  enableRepoAnalysis: boolean;
}

// ============================================================================
// LIVING CORE
// ============================================================================

export class LivingCore extends EventEmitter {
  private db: Database.Database;
  private config: LivingCoreConfig;
  private running: boolean = false;
  private state: HeartbeatState;
  private researchAdapter: ResearchAdapter;

  constructor(config: Partial<LivingCoreConfig> = {}) {
    super();

    this.config = {
      dbPath: config.dbPath || './ronald.db',
      heartbeatIntervalMs: config.heartbeatIntervalMs || 30000, // 30 seconds
      valueThreshold: config.valueThreshold || 0.5,
      maxConcurrentResearch: config.maxConcurrentResearch || 3,
      questionCooldownMs: config.questionCooldownMs || 300000, // 5 minutes
      enableWebSearch: config.enableWebSearch ?? true,
      enableRepoAnalysis: config.enableRepoAnalysis ?? true,
    };

    this.db = new Database(this.config.dbPath);
    this.initializeSchema();

    // Initialize research adapter
    this.researchAdapter = new ResearchAdapter();
    this.setupResearchAdapterEvents();

    this.state = {
      lastBeat: new Date(),
      observationsProcessed: 0,
      researchCompleted: 0,
      cardsGenerated: 0,
      questionsAsked: 0,
      energyLevel: 1.0,
    };
  }

  // ==========================================================================
  // RESEARCH ADAPTER EVENTS
  // ==========================================================================

  private setupResearchAdapterEvents(): void {
    this.researchAdapter.on('web_search_complete', (data) => this.emit('web_search_complete', data));
    this.researchAdapter.on('web_search_error', (data) => this.emit('web_search_error', data));
    this.researchAdapter.on('repo_search_complete', (data) => this.emit('repo_search_complete', data));
    this.researchAdapter.on('repo_search_error', (data) => this.emit('repo_search_error', data));
    this.researchAdapter.on('arxiv_search_complete', (data) => this.emit('arxiv_search_complete', data));
    this.researchAdapter.on('arxiv_search_error', (data) => this.emit('arxiv_search_error', data));
  }

  // ==========================================================================
  // SCHEMA INITIALIZATION
  // ==========================================================================

  private initializeSchema(): void {
    this.db.exec(`
      -- Observations (stream of consciousness input)
      CREATE TABLE IF NOT EXISTS observations (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        metadata TEXT DEFAULT '{}',
        processed INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      -- Concepts (extracted from observations)
      CREATE TABLE IF NOT EXISTS concepts (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        type TEXT NOT NULL,
        embedding BLOB,
        access_count INTEGER DEFAULT 0,
        last_accessed TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      -- Concept relationships (graph)
      CREATE TABLE IF NOT EXISTS concept_edges (
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        relationship TEXT NOT NULL,
        strength REAL DEFAULT 1.0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (from_id, to_id, relationship),
        FOREIGN KEY (from_id) REFERENCES concepts(id),
        FOREIGN KEY (to_id) REFERENCES concepts(id)
      );

      -- Observation-concept links
      CREATE TABLE IF NOT EXISTS observation_concepts (
        observation_id TEXT NOT NULL,
        concept_id TEXT NOT NULL,
        strength REAL DEFAULT 1.0,
        PRIMARY KEY (observation_id, concept_id),
        FOREIGN KEY (observation_id) REFERENCES observations(id),
        FOREIGN KEY (concept_id) REFERENCES concepts(id)
      );

      -- Beliefs (world model)
      CREATE TABLE IF NOT EXISTS beliefs (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        confidence REAL DEFAULT 0.5,
        evidence TEXT DEFAULT '[]',
        contradictions TEXT DEFAULT '[]',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      -- Rabbit holes (research topics)
      CREATE TABLE IF NOT EXISTS rabbit_holes (
        id TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        concepts TEXT DEFAULT '[]',
        estimated_value REAL DEFAULT 0.5,
        estimated_cost REAL DEFAULT 0.5,
        suggested_depth TEXT DEFAULT 'read',
        status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      -- Research results
      CREATE TABLE IF NOT EXISTS research_results (
        id TEXT PRIMARY KEY,
        rabbit_hole_id TEXT NOT NULL,
        source TEXT NOT NULL,
        source_type TEXT NOT NULL,
        content TEXT NOT NULL,
        insights TEXT DEFAULT '[]',
        quality REAL DEFAULT 0.5,
        fetched_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (rabbit_hole_id) REFERENCES rabbit_holes(id)
      );

      -- Cards (meaningful output)
      CREATE TABLE IF NOT EXISTS cards (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        concepts TEXT DEFAULT '[]',
        evidence TEXT DEFAULT '[]',
        suggested_actions TEXT DEFAULT '[]',
        confidence REAL DEFAULT 0.5,
        surfaced INTEGER DEFAULT 0,
        surfaced_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      -- Conflicts (belief inconsistencies)
      CREATE TABLE IF NOT EXISTS conflicts (
        id TEXT PRIMARY KEY,
        observation_id TEXT NOT NULL,
        belief_id TEXT NOT NULL,
        description TEXT NOT NULL,
        severity TEXT DEFAULT 'medium',
        resolved INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (observation_id) REFERENCES observations(id),
        FOREIGN KEY (belief_id) REFERENCES beliefs(id)
      );

      -- Questions (clarifications needed)
      CREATE TABLE IF NOT EXISTS questions (
        id TEXT PRIMARY KEY,
        conflict_id TEXT,
        question TEXT NOT NULL,
        options TEXT DEFAULT '[]',
        importance TEXT DEFAULT 'important',
        answered INTEGER DEFAULT 0,
        answer TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conflict_id) REFERENCES conflicts(id)
      );

      -- Research habits (learned patterns)
      CREATE TABLE IF NOT EXISTS research_habits (
        id TEXT PRIMARY KEY,
        pattern_type TEXT NOT NULL,
        pattern_data TEXT NOT NULL,
        confidence REAL DEFAULT 0.5,
        occurrences INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      -- Heartbeat log (continuous identity)
      CREATE TABLE IF NOT EXISTS heartbeat_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        observations_processed INTEGER DEFAULT 0,
        research_completed INTEGER DEFAULT 0,
        cards_generated INTEGER DEFAULT 0,
        energy_level REAL DEFAULT 1.0,
        notes TEXT
      );

      -- Indexes for performance
      CREATE INDEX IF NOT EXISTS idx_observations_processed ON observations(processed);
      CREATE INDEX IF NOT EXISTS idx_observations_timestamp ON observations(timestamp);
      CREATE INDEX IF NOT EXISTS idx_concepts_name ON concepts(name);
      CREATE INDEX IF NOT EXISTS idx_rabbit_holes_status ON rabbit_holes(status);
      CREATE INDEX IF NOT EXISTS idx_cards_surfaced ON cards(surfaced);
      CREATE INDEX IF NOT EXISTS idx_questions_answered ON questions(answered);
    `);
  }

  // ==========================================================================
  // OBSERVATION STREAM
  // ==========================================================================

  /**
   * Receive a new observation into the stream of consciousness
   */
  observe(source: ObservationSource, content: string, metadata: Record<string, unknown> = {}): string {
    const id = this.generateId();
    const timestamp = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO observations (id, source, content, timestamp, metadata)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, source, content, timestamp, JSON.stringify(metadata));

    this.emit('observation', { id, source, content, timestamp, metadata });

    // If running, wake up to process
    if (this.running) {
      this.emit('wake');
    }

    return id;
  }

  /**
   * Get unprocessed observations
   */
  private getUnprocessedObservations(): Observation[] {
    const rows = this.db.prepare(`
      SELECT * FROM observations WHERE processed = 0 ORDER BY timestamp ASC
    `).all() as any[];

    return rows.map(row => ({
      id: row.id,
      source: row.source as ObservationSource,
      content: row.content,
      timestamp: new Date(row.timestamp),
      metadata: JSON.parse(row.metadata || '{}'),
      processed: Boolean(row.processed),
    }));
  }

  // ==========================================================================
  // CONCEPT EXTRACTION
  // ==========================================================================

  /**
   * Extract concepts from observation content
   */
  private extractConcepts(content: string): Array<{ name: string; type: Concept['type'] }> {
    const concepts: Array<{ name: string; type: Concept['type'] }> = [];

    // Technology patterns
    const techPatterns = [
      /\b(React|Vue|Angular|Svelte|Next\.js|Nuxt|Remix)\b/gi,
      /\b(TypeScript|JavaScript|Python|Rust|Go|Java)\b/gi,
      /\b(SDUI|HMR|SSR|SSG|SPA|MPA|PWA)\b/gi,
      /\b(Webpack|Vite|esbuild|Rollup|Parcel)\b/gi,
      /\b(GraphQL|REST|gRPC|WebSocket)\b/gi,
      /\b(Docker|Kubernetes|AWS|GCP|Azure)\b/gi,
      /\b(PostgreSQL|SQLite|MongoDB|Redis)\b/gi,
      /\b(micro[-\s]?front[-\s]?ends?|module\s+federation)\b/gi,
    ];

    // Pattern patterns (concepts)
    const patternPatterns = [
      /\b(BDI|MVC|MVVM|MVP|CQRS|event[-\s]?sourcing)\b/gi,
      /\b(ADHD|attention|focus|memory|cognition)\b/gi,
      /\b(antimemory|proactive|anticipation)\b/gi,
    ];

    for (const pattern of techPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        for (const match of matches) {
          concepts.push({ name: match.toLowerCase(), type: 'technology' });
        }
      }
    }

    for (const pattern of patternPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        for (const match of matches) {
          concepts.push({ name: match.toLowerCase(), type: 'pattern' });
        }
      }
    }

    // Deduplicate
    const seen = new Set<string>();
    return concepts.filter(c => {
      const key = c.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Store or update a concept
   */
  private upsertConcept(name: string, type: Concept['type']): string {
    const existing = this.db.prepare(`
      SELECT id FROM concepts WHERE name = ?
    `).get(name.toLowerCase()) as { id: string } | undefined;

    if (existing) {
      this.db.prepare(`
        UPDATE concepts SET access_count = access_count + 1, last_accessed = ? WHERE id = ?
      `).run(new Date().toISOString(), existing.id);
      return existing.id;
    }

    const id = this.generateId();
    this.db.prepare(`
      INSERT INTO concepts (id, name, type, last_accessed) VALUES (?, ?, ?, ?)
    `).run(id, name.toLowerCase(), type, new Date().toISOString());

    return id;
  }

  /**
   * Link observation to concepts
   */
  private linkObservationToConcepts(observationId: string, conceptIds: string[]): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO observation_concepts (observation_id, concept_id) VALUES (?, ?)
    `);

    for (const conceptId of conceptIds) {
      stmt.run(observationId, conceptId);
    }
  }

  // ==========================================================================
  // WORLD MODEL (BELIEFS)
  // ==========================================================================

  /**
   * Check for conflicts between observation and existing beliefs
   */
  private checkConflicts(observation: Observation): Conflict[] {
    const conflicts: Conflict[] = [];

    // Get existing beliefs
    const beliefs = this.db.prepare(`
      SELECT * FROM beliefs WHERE confidence > 0.3
    `).all() as any[];

    // Simple conflict detection: look for contradictory keywords
    // TODO: Use embeddings for semantic conflict detection
    for (const belief of beliefs) {
      const beliefContent = belief.content.toLowerCase();
      const obsContent = observation.content.toLowerCase();

      // Check for explicit contradictions
      const contradictionPatterns = [
        { pos: /\bshould\b/, neg: /\bshould not\b/ },
        { pos: /\bgood\b/, neg: /\bbad\b/ },
        { pos: /\buse\b/, neg: /\bavoid\b/ },
        { pos: /\bprefer\b/, neg: /\bdislike\b/ },
      ];

      for (const pattern of contradictionPatterns) {
        const beliefHasPos = pattern.pos.test(beliefContent);
        const beliefHasNeg = pattern.neg.test(beliefContent);
        const obsHasPos = pattern.pos.test(obsContent);
        const obsHasNeg = pattern.neg.test(obsContent);

        if ((beliefHasPos && obsHasNeg) || (beliefHasNeg && obsHasPos)) {
          // Potential conflict - check if about same topic
          const beliefConcepts = this.extractConcepts(belief.content);
          const obsConcepts = this.extractConcepts(observation.content);

          const overlap = beliefConcepts.filter(bc =>
            obsConcepts.some(oc => oc.name === bc.name)
          );

          if (overlap.length > 0) {
            const conflict: Conflict = {
              id: this.generateId(),
              observationId: observation.id,
              beliefId: belief.id,
              description: `Potential conflict about ${overlap.map(c => c.name).join(', ')}`,
              severity: overlap.length > 1 ? 'high' : 'medium',
              resolved: false,
            };

            this.db.prepare(`
              INSERT INTO conflicts (id, observation_id, belief_id, description, severity)
              VALUES (?, ?, ?, ?, ?)
            `).run(conflict.id, conflict.observationId, conflict.beliefId, conflict.description, conflict.severity);

            conflicts.push(conflict);
          }
        }
      }
    }

    return conflicts;
  }

  /**
   * Generate clarification questions for conflicts
   */
  private generateQuestions(conflicts: Conflict[]): Question[] {
    const questions: Question[] = [];

    // Limit to 2-5 questions as specified
    const maxQuestions = Math.min(conflicts.length, 5);
    const selectedConflicts = conflicts
      .sort((a, b) => {
        const severityOrder = { high: 0, medium: 1, low: 2 };
        return severityOrder[a.severity] - severityOrder[b.severity];
      })
      .slice(0, maxQuestions);

    for (const conflict of selectedConflicts) {
      const belief = this.db.prepare(`SELECT * FROM beliefs WHERE id = ?`).get(conflict.beliefId) as any;
      const observation = this.db.prepare(`SELECT * FROM observations WHERE id = ?`).get(conflict.observationId) as any;

      if (!belief || !observation) continue;

      const question: Question = {
        id: this.generateId(),
        conflictId: conflict.id,
        question: `I noticed a potential conflict. You previously believed: "${belief.content}". But this seems to conflict with: "${observation.content}". How should I handle this?`,
        options: [
          'Update my belief based on the new information',
          'Keep my existing belief, the new observation is an exception',
          'Both are true in different contexts',
          'I need to think about this more',
        ],
        importance: conflict.severity === 'high' ? 'critical' : 'important',
        answered: false,
        createdAt: new Date(),
      };

      this.db.prepare(`
        INSERT INTO questions (id, conflict_id, question, options, importance)
        VALUES (?, ?, ?, ?, ?)
      `).run(question.id, question.conflictId, question.question, JSON.stringify(question.options), question.importance);

      questions.push(question);
    }

    return questions;
  }

  // ==========================================================================
  // RABBIT HOLE EVALUATION
  // ==========================================================================

  /**
   * Evaluate if a topic is worth researching
   */
  private evaluateRabbitHoles(concepts: string[]): RabbitHole[] {
    const rabbitHoles: RabbitHole[] = [];

    // Get concept details
    const conceptDetails = concepts.map(conceptId => {
      return this.db.prepare(`SELECT * FROM concepts WHERE id = ?`).get(conceptId) as any;
    }).filter(Boolean);

    // Group related concepts into potential rabbit holes
    for (const concept of conceptDetails) {
      // Check if we've recently researched this
      const recentResearch = this.db.prepare(`
        SELECT * FROM rabbit_holes
        WHERE concepts LIKE ?
        AND created_at > datetime('now', '-1 day')
      `).get(`%${concept.id}%`) as any;

      if (recentResearch) continue;

      // Estimate value based on:
      // - Access count (frequently accessed = more valuable)
      // - Recency (recently mentioned = more relevant)
      // - Connections (more connected = more important)
      const connectionCount = this.db.prepare(`
        SELECT COUNT(*) as count FROM concept_edges WHERE from_id = ? OR to_id = ?
      `).get(concept.id, concept.id) as { count: number };

      const value = Math.min(1, (
        (concept.access_count / 10) * 0.3 +
        (connectionCount.count / 5) * 0.3 +
        0.4 // Base value for new concepts
      ));

      // Estimate cost based on topic complexity
      // (simple heuristic: longer names = more complex)
      const cost = Math.min(1, concept.name.length / 30 + 0.2);

      const rabbitHole: RabbitHole = {
        id: this.generateId(),
        topic: concept.name,
        concepts: [concept.id],
        estimatedValue: value,
        estimatedCost: cost,
        suggestedDepth: value / cost > 1.5 ? 'deep-dive' : value / cost > 0.8 ? 'read' : 'skim',
        status: 'pending',
        createdAt: new Date(),
      };

      rabbitHoles.push(rabbitHole);
    }

    // Sort by value/cost ratio
    return rabbitHoles.sort((a, b) =>
      (b.estimatedValue / b.estimatedCost) - (a.estimatedValue / a.estimatedCost)
    );
  }

  // ==========================================================================
  // RESEARCH ENGINE
  // ==========================================================================

  /**
   * Actually do research on a rabbit hole
   */
  private async research(rabbitHole: RabbitHole): Promise<ResearchResult[]> {
    const results: ResearchResult[] = [];

    // Update status
    this.db.prepare(`UPDATE rabbit_holes SET status = 'in_progress' WHERE id = ?`).run(rabbitHole.id);

    this.emit('research_start', { rabbitHole });

    try {
      // Web search
      if (this.config.enableWebSearch) {
        const webResults = await this.webSearch(rabbitHole.topic);
        results.push(...webResults.map(r => ({ ...r, rabbitHoleId: rabbitHole.id })));
      }

      // Repo analysis (if topic looks like a technology)
      if (this.config.enableRepoAnalysis && rabbitHole.suggestedDepth === 'deep-dive') {
        const repoResults = await this.searchRepos(rabbitHole.topic);
        results.push(...repoResults.map(r => ({ ...r, rabbitHoleId: rabbitHole.id })));
      }

      // Store results
      for (const result of results) {
        this.db.prepare(`
          INSERT INTO research_results (id, rabbit_hole_id, source, source_type, content, insights, quality, fetched_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          result.id,
          result.rabbitHoleId,
          result.source,
          result.sourceType,
          result.content,
          JSON.stringify(result.insights),
          result.quality,
          result.fetchedAt.toISOString()
        );
      }

      // Update status
      this.db.prepare(`UPDATE rabbit_holes SET status = 'completed' WHERE id = ?`).run(rabbitHole.id);

      this.emit('research_complete', { rabbitHole, results });

    } catch (error) {
      this.db.prepare(`UPDATE rabbit_holes SET status = 'abandoned' WHERE id = ?`).run(rabbitHole.id);
      this.emit('research_error', { rabbitHole, error });
    }

    return results;
  }

  /**
   * Search the web for a topic
   */
  private async webSearch(query: string): Promise<Omit<ResearchResult, 'rabbitHoleId'>[]> {
    const results: Omit<ResearchResult, 'rabbitHoleId'>[] = [];

    try {
      // Web search
      const webResults = await this.researchAdapter.webSearch(query);

      for (const result of webResults) {
        // Fetch content from URL
        const content = await this.researchAdapter.fetchContent(result.url);

        // Extract insights
        const insights = content
          ? this.researchAdapter.extractInsights(content, query)
          : [];

        results.push({
          id: result.id,
          source: result.url,
          sourceType: 'web',
          content: content || result.snippet,
          insights,
          quality: insights.length > 0 ? 0.6 : 0.3,
          fetchedAt: new Date(),
        });
      }

      // Also search arXiv for academic papers
      const papers = await this.researchAdapter.searchArxiv(query, 3);
      for (const paper of papers) {
        results.push({
          id: paper.id,
          source: paper.url,
          sourceType: 'paper',
          content: `${paper.title}\n\nAuthors: ${paper.authors.join(', ')}\n\nAbstract: ${paper.abstract}`,
          insights: [paper.abstract.substring(0, 200) + '...'],
          quality: 0.8, // Academic papers are high quality
          fetchedAt: new Date(),
        });
      }

    } catch (error) {
      this.emit('web_search_error', { query, error });
    }

    return results;
  }

  /**
   * Search GitHub repos for a topic
   */
  private async searchRepos(query: string): Promise<Omit<ResearchResult, 'rabbitHoleId'>[]> {
    const results: Omit<ResearchResult, 'rabbitHoleId'>[] = [];

    try {
      const repos = await this.researchAdapter.searchRepos(query);

      for (const repo of repos) {
        // Fetch README for more context
        const readme = await this.researchAdapter.fetchReadme(repo.fullName);

        // Extract insights from README
        const insights = readme
          ? this.researchAdapter.extractInsights(readme, query)
          : [];

        results.push({
          id: repo.id,
          source: repo.url,
          sourceType: 'repo',
          content: `${repo.fullName} (${repo.stars} stars)\n\n${repo.description}\n\nTopics: ${repo.topics.join(', ')}\n\nLanguage: ${repo.language}${readme ? `\n\nREADME:\n${readme.substring(0, 2000)}...` : ''}`,
          insights,
          quality: Math.min(1, repo.stars / 1000 + 0.3), // More stars = higher quality
          fetchedAt: new Date(),
        });
      }

    } catch (error) {
      this.emit('repo_search_error', { query, error });
    }

    return results;
  }

  // ==========================================================================
  // CARD GENERATION
  // ==========================================================================

  /**
   * Generate meaningful cards from research results
   */
  private generateCards(): Card[] {
    const cards: Card[] = [];

    // Get completed rabbit holes with results that haven't been carded
    const completedHoles = this.db.prepare(`
      SELECT rh.*, GROUP_CONCAT(rr.id) as result_ids
      FROM rabbit_holes rh
      LEFT JOIN research_results rr ON rh.id = rr.rabbit_hole_id
      WHERE rh.status = 'completed'
      AND NOT EXISTS (
        SELECT 1 FROM cards c WHERE c.evidence LIKE '%' || rh.id || '%'
      )
      GROUP BY rh.id
    `).all() as any[];

    for (const hole of completedHoles) {
      if (!hole.result_ids) continue; // No results, no card

      const results = this.db.prepare(`
        SELECT * FROM research_results WHERE rabbit_hole_id = ?
      `).all(hole.id) as any[];

      if (results.length === 0) continue;

      // Calculate average quality
      const avgQuality = results.reduce((sum, r) => sum + r.quality, 0) / results.length;

      // Only generate card if quality is sufficient
      if (avgQuality < 0.3) continue;

      // Combine insights
      const allInsights = results.flatMap(r => JSON.parse(r.insights || '[]'));

      const card: Card = {
        id: this.generateId(),
        type: 'research_brief',
        title: `Research: ${hole.topic}`,
        content: this.synthesizeCardContent(hole, results, allInsights),
        concepts: JSON.parse(hole.concepts || '[]'),
        evidence: results.map(r => r.id),
        suggestedActions: this.generateSuggestedActions(hole, results),
        confidence: avgQuality,
        createdAt: new Date(),
        surfaced: false,
      };

      this.db.prepare(`
        INSERT INTO cards (id, type, title, content, concepts, evidence, suggested_actions, confidence)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        card.id,
        card.type,
        card.title,
        card.content,
        JSON.stringify(card.concepts),
        JSON.stringify(card.evidence),
        JSON.stringify(card.suggestedActions),
        card.confidence
      );

      cards.push(card);
    }

    return cards;
  }

  private synthesizeCardContent(hole: any, results: any[], insights: string[]): string {
    const sources = results.map(r => `- ${r.source} (${r.source_type})`).join('\n');
    const insightText = insights.length > 0
      ? insights.map(i => `- ${i}`).join('\n')
      : 'No specific insights extracted yet.';

    return `## ${hole.topic}

### Sources Analyzed
${sources}

### Key Insights
${insightText}

### Research Depth
${hole.suggested_depth} | Value: ${(hole.estimated_value * 100).toFixed(0)}% | Cost: ${(hole.estimated_cost * 100).toFixed(0)}%
`;
  }

  private generateSuggestedActions(hole: any, results: any[]): string[] {
    const actions: string[] = [];

    if (hole.suggested_depth === 'skim') {
      actions.push('Consider deeper research if this becomes more relevant');
    }

    if (results.some(r => r.source_type === 'repo')) {
      actions.push('Review repository code for implementation patterns');
    }

    actions.push(`Connect ${hole.topic} to existing knowledge graph`);

    return actions;
  }

  // ==========================================================================
  // HEARTBEAT LOOP
  // ==========================================================================

  /**
   * Start the living core
   */
  async start(): Promise<void> {
    if (this.running) return;

    this.running = true;
    this.emit('start');

    console.log('[LivingCore] Starting heartbeat loop...');

    while (this.running) {
      await this.heartbeat();
      await this.sleep(this.config.heartbeatIntervalMs);
    }
  }

  /**
   * Stop the living core
   */
  stop(): void {
    this.running = false;
    this.emit('stop');
    console.log('[LivingCore] Stopped.');
  }

  /**
   * Single heartbeat - the conscious processing cycle
   */
  private async heartbeat(): Promise<void> {
    const beatStart = new Date();
    let observationsProcessed = 0;
    let researchCompleted = 0;
    let cardsGenerated = 0;

    this.emit('heartbeat_start', { timestamp: beatStart });

    try {
      // 1. Process unprocessed observations
      const observations = this.getUnprocessedObservations();

      for (const obs of observations) {
        // Extract concepts
        const extractedConcepts = this.extractConcepts(obs.content);
        const conceptIds = extractedConcepts.map(c => this.upsertConcept(c.name, c.type));

        // Link to observation
        this.linkObservationToConcepts(obs.id, conceptIds);

        // Check for conflicts with existing beliefs
        const conflicts = this.checkConflicts(obs);

        if (conflicts.length > 0) {
          // Generate questions (2-5)
          const questions = this.generateQuestions(conflicts);
          if (questions.length > 0) {
            this.emit('questions', { questions });
            this.state.questionsAsked += questions.length;
          }
        }

        // Evaluate rabbit holes
        const rabbitHoles = this.evaluateRabbitHoles(conceptIds);

        // Research high-value holes
        for (const hole of rabbitHoles) {
          if (hole.estimatedValue / hole.estimatedCost >= this.config.valueThreshold) {
            // Store rabbit hole
            this.db.prepare(`
              INSERT INTO rabbit_holes (id, topic, concepts, estimated_value, estimated_cost, suggested_depth)
              VALUES (?, ?, ?, ?, ?, ?)
            `).run(hole.id, hole.topic, JSON.stringify(hole.concepts), hole.estimatedValue, hole.estimatedCost, hole.suggestedDepth);

            // Do research (limited by max concurrent)
            if (researchCompleted < this.config.maxConcurrentResearch) {
              await this.research(hole);
              researchCompleted++;
            }
          }
        }

        // Mark as processed
        this.db.prepare(`UPDATE observations SET processed = 1 WHERE id = ?`).run(obs.id);
        observationsProcessed++;
      }

      // 2. Generate cards from completed research
      const cards = this.generateCards();
      cardsGenerated = cards.length;

      if (cards.length > 0) {
        // Surface cards
        for (const card of cards) {
          this.db.prepare(`
            UPDATE cards SET surfaced = 1, surfaced_at = ? WHERE id = ?
          `).run(new Date().toISOString(), card.id);
        }
        this.emit('cards', { cards });
      }

      // 3. Update state
      this.state = {
        ...this.state,
        lastBeat: beatStart,
        observationsProcessed: this.state.observationsProcessed + observationsProcessed,
        researchCompleted: this.state.researchCompleted + researchCompleted,
        cardsGenerated: this.state.cardsGenerated + cardsGenerated,
      };

      // 4. Log heartbeat
      this.db.prepare(`
        INSERT INTO heartbeat_log (timestamp, observations_processed, research_completed, cards_generated, energy_level)
        VALUES (?, ?, ?, ?, ?)
      `).run(beatStart.toISOString(), observationsProcessed, researchCompleted, cardsGenerated, this.state.energyLevel);

    } catch (error) {
      this.emit('heartbeat_error', { error });
    }

    this.emit('heartbeat_complete', {
      timestamp: beatStart,
      observationsProcessed,
      researchCompleted,
      cardsGenerated,
    });
  }

  // ==========================================================================
  // UTILITIES
  // ==========================================================================

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get current state
   */
  getState(): HeartbeatState {
    return { ...this.state };
  }

  /**
   * Get pending questions
   */
  getPendingQuestions(): Question[] {
    const rows = this.db.prepare(`
      SELECT * FROM questions WHERE answered = 0 ORDER BY importance DESC, created_at ASC
    `).all() as any[];

    return rows.map(row => ({
      id: row.id,
      conflictId: row.conflict_id,
      question: row.question,
      options: JSON.parse(row.options || '[]'),
      importance: row.importance,
      answered: Boolean(row.answered),
      answer: row.answer,
      createdAt: new Date(row.created_at),
    }));
  }

  /**
   * Answer a question
   */
  answerQuestion(questionId: string, answer: string): void {
    this.db.prepare(`
      UPDATE questions SET answered = 1, answer = ? WHERE id = ?
    `).run(answer, questionId);

    // Resolve the conflict if applicable
    const question = this.db.prepare(`SELECT * FROM questions WHERE id = ?`).get(questionId) as any;
    if (question?.conflict_id) {
      this.db.prepare(`UPDATE conflicts SET resolved = 1 WHERE id = ?`).run(question.conflict_id);
    }

    this.emit('question_answered', { questionId, answer });
  }

  /**
   * Get unsurfaced cards
   */
  getCards(): Card[] {
    const rows = this.db.prepare(`
      SELECT * FROM cards WHERE surfaced = 1 ORDER BY created_at DESC LIMIT 10
    `).all() as any[];

    return rows.map(row => ({
      id: row.id,
      type: row.type,
      title: row.title,
      content: row.content,
      concepts: JSON.parse(row.concepts || '[]'),
      evidence: JSON.parse(row.evidence || '[]'),
      suggestedActions: JSON.parse(row.suggested_actions || '[]'),
      confidence: row.confidence,
      createdAt: new Date(row.created_at),
      surfaced: Boolean(row.surfaced),
      surfacedAt: row.surfaced_at ? new Date(row.surfaced_at) : undefined,
    }));
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.stop();
    this.db.close();
  }
}

// ============================================================================
// CLI INTERFACE
// ============================================================================

if (require.main === module) {
  const core = new LivingCore({
    dbPath: './ronald.db',
    heartbeatIntervalMs: 5000, // 5 seconds for testing
  });

  // Event handlers
  core.on('start', () => console.log('🫀 Living Core started'));
  core.on('heartbeat_start', ({ timestamp }) => console.log(`💓 Heartbeat at ${timestamp.toISOString()}`));
  core.on('heartbeat_complete', (data) => console.log(`✅ Heartbeat complete:`, data));
  core.on('observation', ({ id, content }) => console.log(`👁️ Observation: ${content.substring(0, 50)}...`));
  core.on('questions', ({ questions }) => {
    console.log(`❓ ${questions.length} questions generated:`);
    questions.forEach((q: Question) => console.log(`   - ${q.question.substring(0, 80)}...`));
  });
  core.on('cards', ({ cards }) => {
    console.log(`🃏 ${cards.length} cards generated:`);
    cards.forEach((c: Card) => console.log(`   - ${c.title}`));
  });
  core.on('research_start', ({ rabbitHole }) => console.log(`🐰 Researching: ${rabbitHole.topic}`));
  core.on('web_search_request', ({ query }) => console.log(`🔍 Web search needed: ${query}`));
  core.on('repo_search_request', ({ query }) => console.log(`📦 Repo search needed: ${query}`));

  // Handle stdin for observations
  console.log('Enter observations (thoughts). Press Ctrl+C to exit.');
  console.log('---');

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (data: string) => {
    const content = data.trim();
    if (content) {
      core.observe('thought', content);
    }
  });

  // Start the heartbeat
  core.start().catch(console.error);

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    core.close();
    process.exit(0);
  });
}
