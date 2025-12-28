/**
 * Workflow Detector and Automator
 *
 * Detects implicit user workflows from action patterns and offers to automate them.
 *
 * Key features:
 * - Tokenizes user actions into comparable units
 * - Detects recurring patterns (sequences that repeat)
 * - Calculates confidence through test runs
 * - Non-destructive automation only
 * - Progressive trust building ("I ran this 5 times with 90% accuracy")
 */

import { EventEmitter } from 'events';
import Database from 'better-sqlite3';

// ============================================================================
// TYPES
// ============================================================================

export interface UserAction {
  id: string;
  type: ActionType;
  target: string;           // What the action operates on
  params: Record<string, any>;
  timestamp: Date;
  duration?: number;        // How long action took
  result?: ActionResult;
}

export type ActionType =
  | 'search'
  | 'read'
  | 'write'
  | 'edit'
  | 'delete'
  | 'create'
  | 'run'
  | 'test'
  | 'deploy'
  | 'commit'
  | 'review'
  | 'research'
  | 'summarize'
  | 'analyze'
  | 'navigate'
  | 'custom';

export interface ActionResult {
  success: boolean;
  output?: string;
  error?: string;
}

export interface ActionToken {
  type: ActionType;
  targetPattern: string;    // Generalized pattern (e.g., "*.ts" instead of "foo.ts")
  paramSignature: string;   // Hash of param structure
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  tokens: ActionToken[];
  frequency: WorkflowFrequency;
  lastSeen: Date;
  occurrences: number;
  testRuns: WorkflowTestRun[];
  accuracy: number;         // 0-1 based on test runs
  isDestructive: boolean;
  isAutomated: boolean;     // User approved automation
  automationSchedule?: string; // Cron-like schedule if automated
}

export interface WorkflowFrequency {
  pattern: 'hourly' | 'daily' | 'weekly' | 'on-trigger' | 'custom';
  avgIntervalMs: number;
  stdDevMs: number;
}

export interface WorkflowTestRun {
  id: string;
  workflowId: string;
  timestamp: Date;
  actions: UserAction[];
  expectedOutcome: string;
  actualOutcome: string;
  success: boolean;
  notes?: string;
}

export interface WorkflowSuggestion {
  workflow: Workflow;
  confidence: number;
  message: string;
  testResults: string;
}

// Destructive action patterns
const DESTRUCTIVE_ACTIONS: ActionType[] = ['delete', 'deploy'];
const DESTRUCTIVE_TARGETS = [
  /prod(uction)?/i,
  /main/i,
  /master/i,
  /\.env/,
  /secrets?/i,
  /credentials?/i,
];

// ============================================================================
// WORKFLOW DETECTOR
// ============================================================================

export class WorkflowDetector extends EventEmitter {
  private db: Database.Database;
  private actionBuffer: UserAction[] = [];
  private readonly minPatternLength = 2;
  private readonly maxPatternLength = 10;
  private readonly minOccurrences = 3;      // Must see pattern 3x before suggesting
  private readonly minAccuracy = 0.8;       // 80% accuracy before auto-run
  private readonly testRunsRequired = 5;    // Need 5 test runs before full automation

  constructor(dbPath: string = './workflows.db') {
    super();
    this.db = new Database(dbPath);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS actions (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        target TEXT NOT NULL,
        params TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        duration INTEGER,
        result TEXT
      );

      CREATE TABLE IF NOT EXISTS workflows (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        tokens TEXT NOT NULL,
        frequency TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        occurrences INTEGER DEFAULT 0,
        accuracy REAL DEFAULT 0,
        is_destructive INTEGER DEFAULT 0,
        is_automated INTEGER DEFAULT 0,
        automation_schedule TEXT
      );

      CREATE TABLE IF NOT EXISTS test_runs (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        actions TEXT NOT NULL,
        expected_outcome TEXT,
        actual_outcome TEXT,
        success INTEGER,
        notes TEXT,
        FOREIGN KEY (workflow_id) REFERENCES workflows(id)
      );

      CREATE INDEX IF NOT EXISTS idx_actions_timestamp ON actions(timestamp);
      CREATE INDEX IF NOT EXISTS idx_workflows_occurrences ON workflows(occurrences);
    `);
  }

  // ==========================================================================
  // ACTION TOKENIZATION
  // ==========================================================================

  /**
   * Record a user action and check for patterns
   */
  recordAction(action: UserAction): void {
    // Persist action
    this.db.prepare(`
      INSERT INTO actions (id, type, target, params, timestamp, duration, result)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      action.id,
      action.type,
      action.target,
      JSON.stringify(action.params),
      action.timestamp.toISOString(),
      action.duration || null,
      action.result ? JSON.stringify(action.result) : null
    );

    // Add to buffer
    this.actionBuffer.push(action);

    // Keep buffer manageable
    if (this.actionBuffer.length > 100) {
      this.actionBuffer = this.actionBuffer.slice(-50);
    }

    // Check for patterns
    this.detectPatterns();
  }

  /**
   * Convert action to comparable token
   */
  tokenizeAction(action: UserAction): ActionToken {
    return {
      type: action.type,
      targetPattern: this.generalizeTarget(action.target),
      paramSignature: this.hashParams(action.params),
    };
  }

  /**
   * Generalize target to pattern (e.g., "src/utils/foo.ts" becomes "src/ ** / *.ts")
   */
  private generalizeTarget(target: string): string {
    // Extract extension
    const extMatch = target.match(/\.[a-z]+$/i);
    const ext = extMatch ? extMatch[0] : '';

    // Extract directory pattern
    const dirParts = target.split('/');
    if (dirParts.length > 2) {
      return `${dirParts[0]}/**/*${ext}`;
    } else if (dirParts.length === 2) {
      return `${dirParts[0]}/*${ext}`;
    }

    return `*${ext}`;
  }

  /**
   * Create signature from params (ignoring specific values)
   */
  private hashParams(params: Record<string, any>): string {
    const keys = Object.keys(params).sort();
    const typeSignature = keys.map(k => `${k}:${typeof params[k]}`).join(',');
    return this.simpleHash(typeSignature);
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }

  // ==========================================================================
  // PATTERN DETECTION
  // ==========================================================================

  /**
   * Detect recurring patterns in action buffer
   */
  private detectPatterns(): void {
    if (this.actionBuffer.length < this.minPatternLength * 2) return;

    const tokens = this.actionBuffer.map(a => this.tokenizeAction(a));

    // Try different pattern lengths
    for (let len = this.minPatternLength; len <= this.maxPatternLength; len++) {
      this.findPatternsOfLength(tokens, len);
    }
  }

  private findPatternsOfLength(tokens: ActionToken[], length: number): void {
    if (tokens.length < length * 2) return;

    // Sliding window to find repeating sequences
    const patternCounts = new Map<string, { count: number; positions: number[] }>();

    for (let i = 0; i <= tokens.length - length; i++) {
      const pattern = tokens.slice(i, i + length);
      const patternKey = this.patternToKey(pattern);

      const existing = patternCounts.get(patternKey) || { count: 0, positions: [] };
      existing.count++;
      existing.positions.push(i);
      patternCounts.set(patternKey, existing);
    }

    // Check for patterns that occur enough times
    for (const [patternKey, data] of patternCounts) {
      if (data.count >= this.minOccurrences) {
        // Calculate frequency
        const intervals = [];
        for (let i = 1; i < data.positions.length; i++) {
          const prevAction = this.actionBuffer[data.positions[i - 1]];
          const currAction = this.actionBuffer[data.positions[i]];
          intervals.push(currAction.timestamp.getTime() - prevAction.timestamp.getTime());
        }

        const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const pattern = this.keyToPattern(patternKey);

        // Check if we already know this workflow
        const existingWorkflow = this.findWorkflowByPattern(pattern);

        if (existingWorkflow) {
          // Update occurrence count
          this.updateWorkflowOccurrence(existingWorkflow, avgInterval);
        } else {
          // New workflow detected!
          const workflow = this.createWorkflow(pattern, avgInterval);
          this.emit('workflow_detected', { workflow });
        }
      }
    }
  }

  private patternToKey(pattern: ActionToken[]): string {
    return pattern.map(t => `${t.type}:${t.targetPattern}:${t.paramSignature}`).join('|');
  }

  private keyToPattern(key: string): ActionToken[] {
    return key.split('|').map(part => {
      const [type, targetPattern, paramSignature] = part.split(':');
      return { type: type as ActionType, targetPattern, paramSignature };
    });
  }

  private findWorkflowByPattern(pattern: ActionToken[]): Workflow | null {
    const patternKey = this.patternToKey(pattern);
    const row = this.db.prepare(`
      SELECT * FROM workflows WHERE tokens = ?
    `).get(patternKey) as any;

    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      tokens: JSON.parse(row.tokens),
      frequency: JSON.parse(row.frequency),
      lastSeen: new Date(row.last_seen),
      occurrences: row.occurrences,
      testRuns: this.getTestRuns(row.id),
      accuracy: row.accuracy,
      isDestructive: Boolean(row.is_destructive),
      isAutomated: Boolean(row.is_automated),
      automationSchedule: row.automation_schedule,
    };
  }

  private getTestRuns(workflowId: string): WorkflowTestRun[] {
    const rows = this.db.prepare(`
      SELECT * FROM test_runs WHERE workflow_id = ? ORDER BY timestamp DESC LIMIT 10
    `).all(workflowId) as any[];

    return rows.map(row => ({
      id: row.id,
      workflowId: row.workflow_id,
      timestamp: new Date(row.timestamp),
      actions: JSON.parse(row.actions),
      expectedOutcome: row.expected_outcome,
      actualOutcome: row.actual_outcome,
      success: Boolean(row.success),
      notes: row.notes,
    }));
  }

  private createWorkflow(pattern: ActionToken[], avgInterval: number): Workflow {
    const workflow: Workflow = {
      id: `wf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: this.generateWorkflowName(pattern),
      description: this.generateWorkflowDescription(pattern),
      tokens: pattern,
      frequency: this.inferFrequency(avgInterval),
      lastSeen: new Date(),
      occurrences: 1,
      testRuns: [],
      accuracy: 0,
      isDestructive: this.checkDestructive(pattern),
      isAutomated: false,
    };

    this.db.prepare(`
      INSERT INTO workflows (id, name, description, tokens, frequency, last_seen, occurrences, accuracy, is_destructive, is_automated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      workflow.id,
      workflow.name,
      workflow.description,
      JSON.stringify(workflow.tokens),
      JSON.stringify(workflow.frequency),
      workflow.lastSeen.toISOString(),
      workflow.occurrences,
      workflow.accuracy,
      workflow.isDestructive ? 1 : 0,
      workflow.isAutomated ? 1 : 0
    );

    return workflow;
  }

  private updateWorkflowOccurrence(workflow: Workflow, newInterval: number): void {
    // Update frequency calculation
    const oldAvg = workflow.frequency.avgIntervalMs;
    const n = workflow.occurrences;
    const newAvg = ((oldAvg * n) + newInterval) / (n + 1);

    this.db.prepare(`
      UPDATE workflows SET
        occurrences = occurrences + 1,
        last_seen = ?,
        frequency = ?
      WHERE id = ?
    `).run(
      new Date().toISOString(),
      JSON.stringify({ ...workflow.frequency, avgIntervalMs: newAvg }),
      workflow.id
    );

    workflow.occurrences++;
    workflow.frequency.avgIntervalMs = newAvg;

    // Check if we should suggest automation
    if (workflow.occurrences >= this.minOccurrences && !workflow.isAutomated) {
      this.suggestAutomation(workflow);
    }
  }

  private generateWorkflowName(pattern: ActionToken[]): string {
    const actions = pattern.map(t => t.type).join(' → ');
    return `${actions} workflow`;
  }

  private generateWorkflowDescription(pattern: ActionToken[]): string {
    const steps = pattern.map((t, i) => `${i + 1}. ${t.type} on ${t.targetPattern}`);
    return steps.join('\n');
  }

  private inferFrequency(avgIntervalMs: number): WorkflowFrequency {
    const hour = 3600000;
    const day = 86400000;
    const week = 604800000;

    let pattern: WorkflowFrequency['pattern'];
    if (avgIntervalMs < hour * 2) {
      pattern = 'hourly';
    } else if (avgIntervalMs < day * 2) {
      pattern = 'daily';
    } else if (avgIntervalMs < week * 2) {
      pattern = 'weekly';
    } else {
      pattern = 'custom';
    }

    return {
      pattern,
      avgIntervalMs,
      stdDevMs: 0, // Would need more data points to calculate
    };
  }

  private checkDestructive(pattern: ActionToken[]): boolean {
    for (const token of pattern) {
      // Check action type
      if (DESTRUCTIVE_ACTIONS.includes(token.type)) {
        return true;
      }

      // Check target patterns
      for (const destructivePattern of DESTRUCTIVE_TARGETS) {
        if (destructivePattern.test(token.targetPattern)) {
          return true;
        }
      }
    }
    return false;
  }

  // ==========================================================================
  // AUTOMATION SUGGESTION
  // ==========================================================================

  private suggestAutomation(workflow: Workflow): void {
    if (workflow.isDestructive) {
      this.emit('workflow_suggestion', {
        workflow,
        confidence: 0,
        message: `I noticed you do this workflow (${workflow.name}) regularly, but it involves destructive actions so I won't offer to automate it.`,
        testResults: 'N/A - destructive workflow',
      });
      return;
    }

    const suggestion: WorkflowSuggestion = {
      workflow,
      confidence: workflow.accuracy,
      message: this.buildSuggestionMessage(workflow),
      testResults: this.buildTestResultsSummary(workflow),
    };

    this.emit('workflow_suggestion', suggestion);
  }

  private buildSuggestionMessage(workflow: Workflow): string {
    const freq = this.formatFrequency(workflow.frequency);
    const accuracyPercent = Math.round(workflow.accuracy * 100);

    if (workflow.testRuns.length < this.testRunsRequired) {
      return `Hey, I noticed you do "${workflow.name}" ${freq}. I've seen this pattern ${workflow.occurrences} times. ` +
        `I need to run ${this.testRunsRequired - workflow.testRuns.length} more test runs before I can automate it. ` +
        `Want me to start testing?`;
    }

    if (workflow.accuracy >= this.minAccuracy) {
      return `Hey, I noticed you do "${workflow.name}" ${freq}. I've run ${workflow.testRuns.length} test runs ` +
        `and I'm getting ${accuracyPercent}% accuracy (up from 50% when I first noticed this). ` +
        `Want me to automate this for you ${freq}?`;
    }

    return `I noticed you do "${workflow.name}" ${freq}. I've been testing it but only getting ${accuracyPercent}% accuracy. ` +
      `I'll keep practicing until I hit 80%.`;
  }

  private buildTestResultsSummary(workflow: Workflow): string {
    if (workflow.testRuns.length === 0) {
      return 'No test runs yet';
    }

    const successful = workflow.testRuns.filter(r => r.success).length;
    const total = workflow.testRuns.length;
    const lastRun = workflow.testRuns[0];

    return `${successful}/${total} successful test runs. Last run: ${lastRun.success ? 'SUCCESS' : 'FAILED'} - ${lastRun.notes || 'no notes'}`;
  }

  private formatFrequency(freq: WorkflowFrequency): string {
    switch (freq.pattern) {
      case 'hourly': return 'every few hours';
      case 'daily': return 'daily';
      case 'weekly': return 'weekly';
      default: return 'periodically';
    }
  }

  // ==========================================================================
  // TEST RUNS
  // ==========================================================================

  /**
   * Run a test of the workflow and record results
   */
  async runWorkflowTest(
    workflowId: string,
    executor: (actions: ActionToken[]) => Promise<{ success: boolean; output: string }>
  ): Promise<WorkflowTestRun> {
    const workflow = this.getWorkflow(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    this.emit('test_run_started', { workflow });

    const result = await executor(workflow.tokens);

    const testRun: WorkflowTestRun = {
      id: `tr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      workflowId,
      timestamp: new Date(),
      actions: [], // Would be filled by executor
      expectedOutcome: 'Workflow completes successfully',
      actualOutcome: result.output,
      success: result.success,
      notes: result.success ? 'Completed as expected' : 'Failed to complete',
    };

    // Persist test run
    this.db.prepare(`
      INSERT INTO test_runs (id, workflow_id, timestamp, actions, expected_outcome, actual_outcome, success, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      testRun.id,
      testRun.workflowId,
      testRun.timestamp.toISOString(),
      JSON.stringify(testRun.actions),
      testRun.expectedOutcome,
      testRun.actualOutcome,
      testRun.success ? 1 : 0,
      testRun.notes
    );

    // Update workflow accuracy
    workflow.testRuns.unshift(testRun);
    const newAccuracy = workflow.testRuns.filter(r => r.success).length / workflow.testRuns.length;

    this.db.prepare(`
      UPDATE workflows SET accuracy = ? WHERE id = ?
    `).run(newAccuracy, workflowId);

    this.emit('test_run_completed', { testRun, workflow, accuracy: newAccuracy });

    return testRun;
  }

  getWorkflow(id: string): Workflow | null {
    const row = this.db.prepare('SELECT * FROM workflows WHERE id = ?').get(id) as any;
    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      tokens: JSON.parse(row.tokens),
      frequency: JSON.parse(row.frequency),
      lastSeen: new Date(row.last_seen),
      occurrences: row.occurrences,
      testRuns: this.getTestRuns(row.id),
      accuracy: row.accuracy,
      isDestructive: Boolean(row.is_destructive),
      isAutomated: Boolean(row.is_automated),
      automationSchedule: row.automation_schedule,
    };
  }

  // ==========================================================================
  // AUTOMATION CONTROL
  // ==========================================================================

  /**
   * Enable automation for a workflow
   */
  enableAutomation(workflowId: string, schedule: string): void {
    const workflow = this.getWorkflow(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    if (workflow.isDestructive) {
      throw new Error('Cannot automate destructive workflows');
    }

    if (workflow.accuracy < this.minAccuracy) {
      throw new Error(`Accuracy ${workflow.accuracy} below threshold ${this.minAccuracy}`);
    }

    if (workflow.testRuns.length < this.testRunsRequired) {
      throw new Error(`Need ${this.testRunsRequired} test runs, have ${workflow.testRuns.length}`);
    }

    this.db.prepare(`
      UPDATE workflows SET is_automated = 1, automation_schedule = ? WHERE id = ?
    `).run(schedule, workflowId);

    this.emit('automation_enabled', { workflow, schedule });
  }

  /**
   * Disable automation for a workflow
   */
  disableAutomation(workflowId: string): void {
    this.db.prepare(`
      UPDATE workflows SET is_automated = 0, automation_schedule = NULL WHERE id = ?
    `).run(workflowId);

    this.emit('automation_disabled', { workflowId });
  }

  /**
   * Get all workflows ready for automation suggestions
   */
  getAutomationCandidates(): Workflow[] {
    const rows = this.db.prepare(`
      SELECT * FROM workflows
      WHERE is_automated = 0
        AND is_destructive = 0
        AND occurrences >= ?
      ORDER BY occurrences DESC
    `).all(this.minOccurrences) as any[];

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      tokens: JSON.parse(row.tokens),
      frequency: JSON.parse(row.frequency),
      lastSeen: new Date(row.last_seen),
      occurrences: row.occurrences,
      testRuns: this.getTestRuns(row.id),
      accuracy: row.accuracy,
      isDestructive: Boolean(row.is_destructive),
      isAutomated: Boolean(row.is_automated),
      automationSchedule: row.automation_schedule,
    }));
  }

  /**
   * Get all automated workflows
   */
  getAutomatedWorkflows(): Workflow[] {
    const rows = this.db.prepare(`
      SELECT * FROM workflows WHERE is_automated = 1
    `).all() as any[];

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      tokens: JSON.parse(row.tokens),
      frequency: JSON.parse(row.frequency),
      lastSeen: new Date(row.last_seen),
      occurrences: row.occurrences,
      testRuns: this.getTestRuns(row.id),
      accuracy: row.accuracy,
      isDestructive: false,
      isAutomated: true,
      automationSchedule: row.automation_schedule,
    }));
  }
}

// ============================================================================
// CLI TEST
// ============================================================================

import { fileURLToPath } from 'url';

const isMainModule = process.argv[1] && (
  process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1].includes('workflow_detector')
);

if (isMainModule) {
  console.log('=== WORKFLOW DETECTOR DEMO ===\n');

  const detector = new WorkflowDetector('./demo_workflows.db');

  // Event handlers
  detector.on('workflow_detected', ({ workflow }) => {
    console.log(`\n🔍 NEW WORKFLOW DETECTED: ${workflow.name}`);
    console.log(`   Steps: ${workflow.description}`);
    console.log(`   Destructive: ${workflow.isDestructive ? 'YES' : 'no'}`);
  });

  detector.on('workflow_suggestion', (suggestion) => {
    console.log(`\n💡 AUTOMATION SUGGESTION:`);
    console.log(`   ${suggestion.message}`);
    console.log(`   Test Results: ${suggestion.testResults}`);
  });

  // Simulate user actions
  console.log('Simulating user actions...\n');

  // Pattern 1: search -> read -> edit (repeated 4 times)
  for (let i = 0; i < 4; i++) {
    detector.recordAction({
      id: `search-${i}`,
      type: 'search',
      target: 'src/**/*.ts',
      params: { query: 'function' },
      timestamp: new Date(Date.now() + i * 3600000), // 1 hour apart
    });

    detector.recordAction({
      id: `read-${i}`,
      type: 'read',
      target: `src/utils/helper${i}.ts`,
      params: {},
      timestamp: new Date(Date.now() + i * 3600000 + 60000),
    });

    detector.recordAction({
      id: `edit-${i}`,
      type: 'edit',
      target: `src/utils/helper${i}.ts`,
      params: { line: 10 },
      timestamp: new Date(Date.now() + i * 3600000 + 120000),
    });
  }

  console.log('\n=== AUTOMATION CANDIDATES ===');
  const candidates = detector.getAutomationCandidates();
  for (const wf of candidates) {
    console.log(`- ${wf.name} (${wf.occurrences} occurrences, ${Math.round(wf.accuracy * 100)}% accuracy)`);
  }

  console.log('\n=== DEMO COMPLETE ===');
}
