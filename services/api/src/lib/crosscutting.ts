/**
 * Cross-Cutting Concerns for Ronald-GI
 *
 * Implements:
 * 1. PII Detection - Find and redact personal information
 * 2. Audit Logging - Track all system operations
 * 3. Performance Monitoring - Track latencies and throughput
 * 4. Reliability Features - Graceful degradation, retry logic
 */

import Database from 'better-sqlite3';

// ============================================
// PII DETECTION
// ============================================

export interface PIIMatch {
  type: string;
  value: string;
  start: number;
  end: number;
  confidence: number;
}

export interface PIIScanResult {
  hasPII: boolean;
  matches: PIIMatch[];
  redactedContent: string;
  riskLevel: 'low' | 'medium' | 'high';
}

/**
 * Lightweight PII detector (GLiNER/Presidio-inspired)
 * Detects common PII patterns without external dependencies
 */
export class PIIDetector {
  private patterns: Array<{
    type: string;
    regex: RegExp;
    confidence: number;
    risk: 'low' | 'medium' | 'high';
  }>;

  constructor() {
    this.patterns = [
      // High risk - sensitive identifiers
      {
        type: 'ssn',
        regex: /\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/g,
        confidence: 0.9,
        risk: 'high',
      },
      {
        type: 'credit_card',
        regex: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
        confidence: 0.85,
        risk: 'high',
      },
      {
        type: 'api_key',
        regex: /\b(?:sk_live_|pk_live_|api[_-]?key[=:]\s*)[a-zA-Z0-9]{20,}\b/gi,
        confidence: 0.95,
        risk: 'high',
      },
      {
        type: 'aws_key',
        regex: /\b(?:AKIA|ABIA|ACCA|ASIA)[A-Z0-9]{16}\b/g,
        confidence: 0.95,
        risk: 'high',
      },
      {
        type: 'private_key',
        regex: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/g,
        confidence: 0.99,
        risk: 'high',
      },
      {
        type: 'password',
        regex: /(?:password|passwd|pwd)[=:\s]+["']?[^\s"']{8,}["']?/gi,
        confidence: 0.8,
        risk: 'high',
      },

      // Medium risk - personal identifiers
      {
        type: 'email',
        regex: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g,
        confidence: 0.95,
        risk: 'medium',
      },
      {
        type: 'phone',
        regex: /\b(?:\+?1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
        confidence: 0.8,
        risk: 'medium',
      },
      {
        type: 'ip_address',
        regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
        confidence: 0.7,
        risk: 'medium',
      },
      {
        type: 'date_of_birth',
        regex: /\b(?:dob|date of birth|born)[:\s]+\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/gi,
        confidence: 0.75,
        risk: 'medium',
      },
      {
        type: 'address',
        regex: /\b\d+\s+[a-zA-Z]+\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr)[,\s]+[a-zA-Z]+[,\s]+[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/gi,
        confidence: 0.7,
        risk: 'medium',
      },

      // Low risk - may be intentionally public
      {
        type: 'url_with_credentials',
        regex: /https?:\/\/[^:]+:[^@]+@[^\s]+/g,
        confidence: 0.9,
        risk: 'high',
      },
      {
        type: 'github_token',
        regex: /\b(?:ghp_|gho_|ghu_|ghs_|ghr_)[a-zA-Z0-9]{36}\b/g,
        confidence: 0.95,
        risk: 'high',
      },
    ];
  }

  /**
   * Scan content for PII
   */
  scan(content: string): PIIScanResult {
    const matches: PIIMatch[] = [];

    for (const pattern of this.patterns) {
      pattern.regex.lastIndex = 0; // Reset regex state
      let match;
      while ((match = pattern.regex.exec(content)) !== null) {
        matches.push({
          type: pattern.type,
          value: match[0],
          start: match.index,
          end: match.index + match[0].length,
          confidence: pattern.confidence,
        });
      }
    }

    // Determine overall risk
    let riskLevel: 'low' | 'medium' | 'high' = 'low';
    if (matches.some(m => this.patterns.find(p => p.type === m.type)?.risk === 'high')) {
      riskLevel = 'high';
    } else if (matches.some(m => this.patterns.find(p => p.type === m.type)?.risk === 'medium')) {
      riskLevel = 'medium';
    }

    // Generate redacted content
    const redactedContent = this.redact(content, matches);

    return {
      hasPII: matches.length > 0,
      matches,
      redactedContent,
      riskLevel,
    };
  }

  /**
   * Redact PII from content
   */
  redact(content: string, matches?: PIIMatch[]): string {
    if (!matches) {
      matches = this.scan(content).matches;
    }

    // Sort by position descending to replace from end to start
    const sorted = [...matches].sort((a, b) => b.start - a.start);

    let result = content;
    for (const match of sorted) {
      const redaction = `[REDACTED:${match.type.toUpperCase()}]`;
      result = result.slice(0, match.start) + redaction + result.slice(match.end);
    }

    return result;
  }

  /**
   * Check if content is safe to process
   */
  isSafe(content: string, maxRisk: 'low' | 'medium' | 'high' = 'medium'): boolean {
    const result = this.scan(content);
    const riskLevels = { low: 0, medium: 1, high: 2 };
    return riskLevels[result.riskLevel] <= riskLevels[maxRisk];
  }
}

// ============================================
// AUDIT LOGGING
// ============================================

export interface AuditEntry {
  id: string;
  timestamp: string;
  action: string;
  actor: string;
  resource: string;
  resourceId?: string;
  details: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  success: boolean;
  error?: string;
}

export class AuditLogger {
  constructor(private db: Database.Database) {
    this.ensureTable();
  }

  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        timestamp TEXT DEFAULT (datetime('now')),
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        resource TEXT NOT NULL,
        resource_id TEXT,
        details_json TEXT,
        ip_address TEXT,
        user_agent TEXT,
        success INTEGER DEFAULT 1,
        error TEXT
      )
    `);

    // Index for common queries
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor);
      CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_log(resource);
    `);
  }

  /**
   * Log an audit entry
   */
  log(entry: Omit<AuditEntry, 'id' | 'timestamp'>): string {
    const id = this.randomId();
    this.db.prepare(`
      INSERT INTO audit_log (id, action, actor, resource, resource_id, details_json, ip_address, user_agent, success, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      entry.action,
      entry.actor,
      entry.resource,
      entry.resourceId || null,
      JSON.stringify(entry.details),
      entry.ipAddress || null,
      entry.userAgent || null,
      entry.success ? 1 : 0,
      entry.error || null
    );
    return id;
  }

  /**
   * Query audit log
   */
  query(options: {
    actor?: string;
    resource?: string;
    action?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  }): AuditEntry[] {
    const conditions: string[] = ['1=1'];
    const params: any[] = [];

    if (options.actor) {
      conditions.push('actor = ?');
      params.push(options.actor);
    }
    if (options.resource) {
      conditions.push('resource = ?');
      params.push(options.resource);
    }
    if (options.action) {
      conditions.push('action = ?');
      params.push(options.action);
    }
    if (options.startDate) {
      conditions.push('timestamp >= ?');
      params.push(options.startDate);
    }
    if (options.endDate) {
      conditions.push('timestamp <= ?');
      params.push(options.endDate);
    }

    const limit = options.limit || 100;
    const offset = options.offset || 0;

    const rows = this.db.prepare(`
      SELECT * FROM audit_log
      WHERE ${conditions.join(' AND ')}
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as any[];

    return rows.map(r => ({
      id: r.id,
      timestamp: r.timestamp,
      action: r.action,
      actor: r.actor,
      resource: r.resource,
      resourceId: r.resource_id,
      details: r.details_json ? JSON.parse(r.details_json) : {},
      ipAddress: r.ip_address,
      userAgent: r.user_agent,
      success: r.success === 1,
      error: r.error,
    }));
  }

  /**
   * Get audit summary for a resource
   */
  getResourceHistory(resource: string, resourceId: string, limit = 50): AuditEntry[] {
    return this.query({ resource, limit });
  }

  /**
   * Get failed operations
   */
  getFailures(since?: string, limit = 100): AuditEntry[] {
    const rows = this.db.prepare(`
      SELECT * FROM audit_log
      WHERE success = 0
        ${since ? 'AND timestamp >= ?' : ''}
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(...(since ? [since, limit] : [limit])) as any[];

    return rows.map(r => ({
      id: r.id,
      timestamp: r.timestamp,
      action: r.action,
      actor: r.actor,
      resource: r.resource,
      resourceId: r.resource_id,
      details: r.details_json ? JSON.parse(r.details_json) : {},
      ipAddress: r.ip_address,
      userAgent: r.user_agent,
      success: false,
      error: r.error,
    }));
  }

  private randomId(): string {
    return Math.random().toString(36).substring(2, 15) +
           Math.random().toString(36).substring(2, 15);
  }
}

// ============================================
// PERFORMANCE MONITORING
// ============================================

export interface PerformanceMetric {
  operation: string;
  durationMs: number;
  timestamp: string;
  success: boolean;
  metadata?: Record<string, any>;
}

export interface PerformanceStats {
  operation: string;
  count: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  successRate: number;
}

export class PerformanceMonitor {
  private metrics: PerformanceMetric[] = [];
  private maxMetrics = 10000;

  constructor(private db?: Database.Database) {
    if (db) {
      this.ensureTable();
    }
  }

  private ensureTable(): void {
    if (!this.db) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS performance_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operation TEXT NOT NULL,
        duration_ms REAL NOT NULL,
        timestamp TEXT DEFAULT (datetime('now')),
        success INTEGER DEFAULT 1,
        metadata_json TEXT
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_perf_operation ON performance_metrics(operation);
      CREATE INDEX IF NOT EXISTS idx_perf_timestamp ON performance_metrics(timestamp);
    `);
  }

  /**
   * Record a performance metric
   */
  record(metric: Omit<PerformanceMetric, 'timestamp'>): void {
    const entry: PerformanceMetric = {
      ...metric,
      timestamp: new Date().toISOString(),
    };

    // Keep in memory for fast access
    this.metrics.push(entry);
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics);
    }

    // Also persist to database if available
    if (this.db) {
      this.db.prepare(`
        INSERT INTO performance_metrics (operation, duration_ms, success, metadata_json)
        VALUES (?, ?, ?, ?)
      `).run(
        metric.operation,
        metric.durationMs,
        metric.success ? 1 : 0,
        metric.metadata ? JSON.stringify(metric.metadata) : null
      );
    }
  }

  /**
   * Create a timer for measuring operations
   */
  startTimer(operation: string): () => void {
    const start = performance.now();
    return () => {
      const durationMs = performance.now() - start;
      this.record({ operation, durationMs, success: true });
    };
  }

  /**
   * Wrap an async function with performance tracking
   */
  async measure<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      const result = await fn();
      this.record({ operation, durationMs: performance.now() - start, success: true });
      return result;
    } catch (error) {
      this.record({ operation, durationMs: performance.now() - start, success: false });
      throw error;
    }
  }

  /**
   * Get statistics for an operation
   */
  getStats(operation: string, since?: Date): PerformanceStats {
    let data = this.metrics.filter(m => m.operation === operation);
    if (since) {
      data = data.filter(m => new Date(m.timestamp) >= since);
    }

    if (data.length === 0) {
      return {
        operation,
        count: 0,
        avgMs: 0,
        p50Ms: 0,
        p95Ms: 0,
        p99Ms: 0,
        successRate: 0,
      };
    }

    const durations = data.map(d => d.durationMs).sort((a, b) => a - b);
    const successCount = data.filter(d => d.success).length;

    return {
      operation,
      count: data.length,
      avgMs: durations.reduce((a, b) => a + b, 0) / durations.length,
      p50Ms: this.percentile(durations, 50),
      p95Ms: this.percentile(durations, 95),
      p99Ms: this.percentile(durations, 99),
      successRate: successCount / data.length,
    };
  }

  /**
   * Get all operation stats
   */
  getAllStats(since?: Date): PerformanceStats[] {
    const operations = [...new Set(this.metrics.map(m => m.operation))];
    return operations.map(op => this.getStats(op, since));
  }

  /**
   * Check if operation is within SLA
   */
  checkSLA(operation: string, maxP95Ms: number): boolean {
    const stats = this.getStats(operation, new Date(Date.now() - 3600000)); // Last hour
    return stats.p95Ms <= maxP95Ms;
  }

  private percentile(sortedValues: number[], p: number): number {
    if (sortedValues.length === 0) return 0;
    const index = Math.ceil((p / 100) * sortedValues.length) - 1;
    return sortedValues[Math.max(0, index)];
  }
}

// ============================================
// RELIABILITY FEATURES
// ============================================

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  exponentialBase: number;
  shouldRetry?: (error: Error) => boolean;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 100,
  maxDelayMs: 10000,
  exponentialBase: 2,
};

/**
 * Retry a function with exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Check if we should retry
      if (opts.shouldRetry && !opts.shouldRetry(lastError)) {
        throw lastError;
      }

      if (attempt < opts.maxRetries) {
        // Calculate delay with exponential backoff + jitter
        const delay = Math.min(
          opts.maxDelayMs,
          opts.baseDelayMs * Math.pow(opts.exponentialBase, attempt) + Math.random() * 100
        );
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Circuit breaker for failing operations
 */
export class CircuitBreaker {
  private failures = 0;
  private lastFailure?: Date;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    private options: {
      failureThreshold: number;
      resetTimeoutMs: number;
    } = { failureThreshold: 5, resetTimeoutMs: 30000 }
  ) {}

  /**
   * Execute an operation through the circuit breaker
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      // Check if we should try again
      if (this.lastFailure && Date.now() - this.lastFailure.getTime() >= this.options.resetTimeoutMs) {
        this.state = 'half-open';
      } else {
        throw new Error('Circuit breaker is open');
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailure = new Date();

    if (this.failures >= this.options.failureThreshold) {
      this.state = 'open';
    }
  }

  getState(): 'closed' | 'open' | 'half-open' {
    return this.state;
  }

  reset(): void {
    this.failures = 0;
    this.state = 'closed';
    this.lastFailure = undefined;
  }
}

/**
 * Graceful degradation handler
 */
export class GracefulDegrader<T> {
  private fallbackValue: T;
  private breaker: CircuitBreaker;

  constructor(fallbackValue: T, breakerOptions?: { failureThreshold: number; resetTimeoutMs: number }) {
    this.fallbackValue = fallbackValue;
    this.breaker = new CircuitBreaker(breakerOptions);
  }

  /**
   * Execute with graceful fallback
   */
  async execute(fn: () => Promise<T>): Promise<T> {
    try {
      return await this.breaker.execute(fn);
    } catch (error) {
      console.warn('Degrading gracefully:', error);
      return this.fallbackValue;
    }
  }

  getCircuitState(): string {
    return this.breaker.getState();
  }
}

// ============================================
// HEALTH CHECK SYSTEM
// ============================================

export interface HealthCheck {
  name: string;
  check: () => Promise<{ healthy: boolean; message?: string; latencyMs?: number }>;
}

export interface HealthStatus {
  healthy: boolean;
  checks: Array<{
    name: string;
    healthy: boolean;
    message?: string;
    latencyMs?: number;
  }>;
  timestamp: string;
}

export class HealthChecker {
  private checks: HealthCheck[] = [];

  /**
   * Register a health check
   */
  register(check: HealthCheck): void {
    this.checks.push(check);
  }

  /**
   * Run all health checks
   */
  async checkAll(): Promise<HealthStatus> {
    const results = await Promise.all(
      this.checks.map(async check => {
        const start = performance.now();
        try {
          const result = await check.check();
          return {
            name: check.name,
            ...result,
            latencyMs: result.latencyMs ?? performance.now() - start,
          };
        } catch (error) {
          return {
            name: check.name,
            healthy: false,
            message: error instanceof Error ? error.message : 'Unknown error',
            latencyMs: performance.now() - start,
          };
        }
      })
    );

    return {
      healthy: results.every(r => r.healthy),
      checks: results,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Create common health checks
   */
  static createDatabaseCheck(db: Database.Database): HealthCheck {
    return {
      name: 'database',
      check: async () => {
        try {
          const result = db.prepare('SELECT 1 as ok').get() as any;
          return { healthy: result?.ok === 1 };
        } catch (error) {
          return { healthy: false, message: 'Database query failed' };
        }
      },
    };
  }
}

// ============================================
// EXPORTS
// ============================================

export function createCrossCuttingSystem(db: Database.Database) {
  const healthChecker = new HealthChecker();
  healthChecker.register(HealthChecker.createDatabaseCheck(db));

  return {
    pii: new PIIDetector(),
    audit: new AuditLogger(db),
    performance: new PerformanceMonitor(db),
    health: healthChecker,
    circuitBreaker: (opts?: { failureThreshold: number; resetTimeoutMs: number }) => new CircuitBreaker(opts),
    gracefulDegrader: <T>(fallback: T) => new GracefulDegrader(fallback),
    withRetry,
  };
}
