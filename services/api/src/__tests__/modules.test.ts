/**
 * Module Tests for Ronald-GI
 *
 * Tests for:
 * - Dataset Builder (Phase 8)
 * - Domain Modules (Phase 9)
 * - Cross-Cutting Concerns
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  getTestDb,
  resetTestDb,
  closeTestDb,
  createTestReport,
  createTestConcept,
  simulateEngagement,
  submitFeedback,
} from './setup';
import { DatasetBuilder, TrainingManager, createDatasetSystem } from '../lib/dataset_builder';
import { DomainRouter, FinanceDomainModule, PeopleDomainModule, OperationsDomainModule, createDomainSystem } from '../lib/domain_modules';
import { PIIDetector, AuditLogger, PerformanceMonitor, CircuitBreaker, withRetry, createCrossCuttingSystem } from '../lib/crosscutting';

describe('Phase 8: Dataset Builder', () => {
  let db: ReturnType<typeof getTestDb>;

  beforeEach(() => {
    resetTestDb();
    db = getTestDb();
  });

  afterAll(() => {
    closeTestDb();
  });

  describe('Preference Data Collection', () => {
    it('should collect pinned reports as highest-value examples', () => {
      // Create pinned report
      const reportId = createTestReport(db, {
        title: 'Valuable Research',
        summary: 'Important findings',
        decision: 'Take action',
        pinned: 1,
      });

      const builder = new DatasetBuilder(db);
      const data = builder.collectPreferenceData();

      const pinned = data.filter(d => d.type === 'pinned');
      expect(pinned.length).toBe(1);
      expect(pinned[0].score).toBe(1.0);
      expect(pinned[0].chosen).toBe(true);
    });

    it('should collect feedback as explicit preference signals', () => {
      const goodReport = createTestReport(db, { title: 'Good Report' });
      const badReport = createTestReport(db, { title: 'Bad Report' });

      submitFeedback(db, goodReport, 'useful');
      submitFeedback(db, badReport, 'not_useful');

      const builder = new DatasetBuilder(db);
      const data = builder.collectPreferenceData();

      const accepted = data.filter(d => d.type === 'accepted');
      const rejected = data.filter(d => d.type === 'rejected');

      expect(accepted.length).toBe(1);
      expect(rejected.length).toBe(1);
      expect(accepted[0].chosen).toBe(true);
      expect(rejected[0].chosen).toBe(false);
    });

    it('should collect engagement signals as implicit preferences', () => {
      const engagedReport = createTestReport(db, { title: 'Engaging Report' });
      simulateEngagement(db, engagedReport, {
        opened: true,
        scrollDepth: 0.95,
        dwellMs: 30000,
        clicked: true,
      });

      const builder = new DatasetBuilder(db);
      const data = builder.collectPreferenceData();

      const engagement = data.filter(d => d.type === 'engagement');
      expect(engagement.length).toBeGreaterThan(0);
      expect(engagement[0].score).toBeGreaterThan(0.5);
    });
  });

  describe('Training Data Export', () => {
    it('should export as JSONL format', () => {
      createTestReport(db, { title: 'Report 1', summary: 'Summary 1', pinned: 1 });
      createTestReport(db, { title: 'Report 2', summary: 'Summary 2' });

      const builder = new DatasetBuilder(db);
      const jsonl = builder.exportAsJSONL();

      const lines = jsonl.split('\n').filter(l => l.trim());
      expect(lines.length).toBeGreaterThan(0);

      // Each line should be valid JSON
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    });

    it('should build training examples with prompt/chosen pairs', () => {
      createTestReport(db, { title: 'Good Report', pinned: 1 });

      const builder = new DatasetBuilder(db);
      const examples = builder.buildTrainingExamples();

      expect(examples.length).toBeGreaterThan(0);
      expect(examples[0]).toHaveProperty('prompt');
      expect(examples[0]).toHaveProperty('chosen');
      expect(examples[0]).toHaveProperty('weight');
    });

    it('should generate dataset statistics', () => {
      createTestReport(db, { title: 'Pinned', pinned: 1 });
      const report = createTestReport(db, { title: 'Engaged' });
      simulateEngagement(db, report, { opened: true, scrollDepth: 0.9 });
      submitFeedback(db, report, 'useful');

      const builder = new DatasetBuilder(db);
      const stats = builder.getStats();

      expect(stats.totalExamples).toBeGreaterThan(0);
      expect(stats.pinnedCount).toBe(1);
    });
  });

  describe('Training Manager', () => {
    it('should create and track training jobs', () => {
      const manager = new TrainingManager(db);

      const jobId = manager.createJob({
        modelBase: 'mlx-community/Llama-3.2-1B',
        method: 'lora',
        loraRank: 8,
        learningRate: 1e-4,
        epochs: 3,
        batchSize: 4,
        outputDir: '/tmp/models',
      }, '/tmp/dataset.jsonl');

      const job = manager.getJob(jobId);
      expect(job).toBeDefined();
      expect(job.status).toBe('pending');
    });

    it('should update job progress', () => {
      const manager = new TrainingManager(db);
      const jobId = manager.createJob({
        modelBase: 'test-model',
        method: 'lora',
        learningRate: 1e-4,
        epochs: 1,
        batchSize: 4,
        outputDir: '/tmp',
      }, '/tmp/data.jsonl');

      manager.updateProgress(jobId, 0.5, { loss: 0.5 });

      const job = manager.getJob(jobId);
      expect(job.progress).toBe(0.5);
    });

    it('should complete job and register model', () => {
      const manager = new TrainingManager(db);
      const jobId = manager.createJob({
        modelBase: 'test-model',
        method: 'lora',
        learningRate: 1e-4,
        epochs: 1,
        batchSize: 4,
        outputDir: '/tmp',
      }, '/tmp/data.jsonl');

      manager.completeJob(jobId, '/tmp/model-output', { loss: 0.1, accuracy: 0.95 });

      const job = manager.getJob(jobId);
      expect(job.status).toBe('completed');
      expect(job.model_path).toBe('/tmp/model-output');

      const models = manager.listModels();
      expect(models.length).toBe(1);
    });

    it('should generate MLX training script', () => {
      const manager = new TrainingManager(db);
      const script = manager.generateMLXTrainingScript({
        modelBase: 'mlx-community/Llama-3.2-1B',
        method: 'lora',
        loraRank: 16,
        learningRate: 1e-4,
        epochs: 5,
        batchSize: 4,
        outputDir: '/tmp/output',
      }, '/tmp/dataset.jsonl');

      expect(script).toContain('mlx_lm.lora');
      expect(script).toContain('LORA_RANK=16');
      expect(script).toContain('/tmp/dataset.jsonl');
    });
  });
});

describe('Phase 9: Domain Modules', () => {
  let db: ReturnType<typeof getTestDb>;

  beforeEach(() => {
    resetTestDb();
    db = getTestDb();
  });

  afterAll(() => {
    closeTestDb();
  });

  describe('Finance Domain Module', () => {
    it('should extract ticker symbols', () => {
      const finance = new FinanceDomainModule(db);
      const entities = finance.extractEntities('Buy $AAPL and $GOOGL, avoid $TSLA');

      const tickers = entities.filter(e => e.type === 'ticker');
      expect(tickers.length).toBe(3);
      expect(tickers.map(t => t.name)).toContain('AAPL');
      expect(tickers.map(t => t.name)).toContain('GOOGL');
    });

    it('should extract monetary values', () => {
      const finance = new FinanceDomainModule(db);
      const entities = finance.extractEntities('Revenue of $5.2 billion, profit $500M');

      const money = entities.filter(e => e.type === 'monetary_value');
      expect(money.length).toBeGreaterThan(0);
    });

    it('should detect sentiment signals', () => {
      const finance = new FinanceDomainModule(db);

      const bullish = finance.detectSignals('Strong buy recommendation, bullish outlook with upside potential');
      expect(bullish.some(s => s.type === 'sentiment' && s.strength > 0)).toBe(true);

      const bearish = finance.detectSignals('Sell rating, bearish trend, significant downside risk');
      expect(bearish.some(s => s.type === 'sentiment' && s.strength < 0)).toBe(true);
    });

    it('should match finance domain content', () => {
      const finance = new FinanceDomainModule(db);
      const score = finance.matchesDomain(
        'The stock market showed strong performance with portfolio gains',
        ['investment', 'trading']
      );
      expect(score).toBeGreaterThan(0.3);
    });
  });

  describe('People Domain Module', () => {
    it('should extract social profiles', () => {
      const people = new PeopleDomainModule(db);
      const entities = people.extractEntities(
        'Follow @johndoe on Twitter, check github.com/johndoe/project, or connect on linkedin.com/in/johndoe'
      );

      expect(entities.some(e => e.type === 'twitter_handle')).toBe(true);
      expect(entities.some(e => e.type === 'github_user' || e.type === 'github_repo')).toBe(true);
      expect(entities.some(e => e.type === 'linkedin_profile')).toBe(true);
    });

    it('should extract role titles', () => {
      const people = new PeopleDomainModule(db);
      const entities = people.extractEntities('John is a Senior Engineer and Co-founder of the startup');

      const roles = entities.filter(e => e.type.includes('role'));
      expect(roles.length).toBeGreaterThan(0);
    });

    it('should detect hiring signals', () => {
      const people = new PeopleDomainModule(db);
      const signals = people.detectSignals('We are hiring! Join us as a Senior Developer. Apply now.');

      expect(signals.some(s => s.type === 'hiring_activity')).toBe(true);
    });
  });

  describe('Operations Domain Module', () => {
    it('should extract cloud services', () => {
      const ops = new OperationsDomainModule(db);
      const entities = ops.extractEntities(
        'Deploy to AWS EC2, use S3 for storage, and GKE for Kubernetes'
      );

      const cloud = entities.filter(e => e.type === 'cloud_service');
      expect(cloud.length).toBeGreaterThan(0);
    });

    it('should extract infrastructure tools', () => {
      const ops = new OperationsDomainModule(db);
      const entities = ops.extractEntities(
        'Using Docker containers orchestrated by Kubernetes, with Terraform for IaC'
      );

      const tools = entities.filter(e => e.type === 'infrastructure_tool');
      expect(tools.length).toBeGreaterThan(0);
    });

    it('should detect incident signals', () => {
      const ops = new OperationsDomainModule(db);
      const signals = ops.detectSignals('Incident report: Service outage due to database failure');

      expect(signals.some(s => s.type === 'incident_indicator')).toBe(true);
    });
  });

  describe('Domain Router', () => {
    it('should route content to appropriate domain', () => {
      const router = new DomainRouter(db);

      const financeAnalysis = router.analyzeContent(
        'Stock market rally with strong earnings from tech sector',
        ['investment', 'trading']
      );
      expect(financeAnalysis[0]?.domain).toBe('finance');

      const opsAnalysis = router.analyzeContent(
        'Kubernetes deployment failed, investigating the incident',
        ['infrastructure', 'devops']
      );
      expect(opsAnalysis[0]?.domain).toBe('operations');
    });

    it('should suggest appropriate report types', () => {
      const router = new DomainRouter(db);

      const financeType = router.suggestReportType(
        'Buy $AAPL on earnings announcement with strong buy recommendation',
        ['stock', 'trading', 'investment']
      );
      // Should suggest a finance-related report type or default to research_brief
      expect(['stock_signal', 'investment_thesis', 'market_analysis', 'research_brief']).toContain(financeType);
    });

    it('should list available domains', () => {
      const router = new DomainRouter(db);
      const domains = router.getAvailableDomains();

      expect(domains).toContain('finance');
      expect(domains).toContain('people');
      expect(domains).toContain('operations');
    });
  });
});

describe('Cross-Cutting Concerns', () => {
  let db: ReturnType<typeof getTestDb>;

  beforeEach(() => {
    resetTestDb();
    db = getTestDb();
  });

  afterAll(() => {
    closeTestDb();
  });

  describe('PII Detection', () => {
    it('should detect email addresses', () => {
      const detector = new PIIDetector();
      const result = detector.scan('Contact us at john.doe@example.com');

      expect(result.hasPII).toBe(true);
      expect(result.matches.some(m => m.type === 'email')).toBe(true);
    });

    it('should detect credit card numbers', () => {
      const detector = new PIIDetector();
      const result = detector.scan('Card: 4111-1111-1111-1111');

      expect(result.hasPII).toBe(true);
      expect(result.matches.some(m => m.type === 'credit_card')).toBe(true);
      expect(result.riskLevel).toBe('high');
    });

    it('should detect API keys', () => {
      const detector = new PIIDetector();
      // Build fake key dynamically to avoid triggering GitHub's secret scanner
      const fakeKey = 'sk_' + 'live_' + 'abcdefghijklmnopqrstuvwxyz123456';
      const result = detector.scan(`Use api_key=${fakeKey}`);

      expect(result.hasPII).toBe(true);
      expect(result.riskLevel).toBe('high');
    });

    it('should detect AWS keys', () => {
      const detector = new PIIDetector();
      const result = detector.scan('AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE');

      expect(result.hasPII).toBe(true);
      expect(result.matches.some(m => m.type === 'aws_key')).toBe(true);
    });

    it('should redact PII from content', () => {
      const detector = new PIIDetector();
      const redacted = detector.redact('Email: john@example.com, Phone: 555-123-4567');

      expect(redacted).toContain('[REDACTED:EMAIL]');
      expect(redacted).toContain('[REDACTED:PHONE]');
      expect(redacted).not.toContain('john@example.com');
    });

    it('should classify risk levels correctly', () => {
      const detector = new PIIDetector();

      const highRisk = detector.scan('SSN: 123-45-6789');
      expect(highRisk.riskLevel).toBe('high');

      const mediumRisk = detector.scan('Call me at 555-123-4567');
      expect(mediumRisk.riskLevel).toBe('medium');

      const lowRisk = detector.scan('Hello world');
      expect(lowRisk.riskLevel).toBe('low');
    });
  });

  describe('Audit Logging', () => {
    it('should log audit entries', () => {
      const audit = new AuditLogger(db);

      const id = audit.log({
        action: 'create',
        actor: 'user123',
        resource: 'report',
        resourceId: 'report456',
        details: { title: 'New Report' },
        success: true,
      });

      expect(id).toBeDefined();

      const entries = audit.query({ actor: 'user123' });
      expect(entries.length).toBe(1);
      expect(entries[0].action).toBe('create');
    });

    it('should query by resource', () => {
      const audit = new AuditLogger(db);

      audit.log({ action: 'create', actor: 'user1', resource: 'report', details: {}, success: true });
      audit.log({ action: 'update', actor: 'user2', resource: 'report', details: {}, success: true });
      audit.log({ action: 'create', actor: 'user1', resource: 'concept', details: {}, success: true });

      const reportEntries = audit.query({ resource: 'report' });
      expect(reportEntries.length).toBe(2);
    });

    it('should track failures', () => {
      const audit = new AuditLogger(db);

      audit.log({ action: 'create', actor: 'user1', resource: 'report', details: {}, success: true });
      audit.log({ action: 'update', actor: 'user2', resource: 'report', details: {}, success: false, error: 'Permission denied' });

      const failures = audit.getFailures();
      expect(failures.length).toBe(1);
      expect(failures[0].error).toBe('Permission denied');
    });
  });

  describe('Performance Monitoring', () => {
    it('should record and report metrics', () => {
      const monitor = new PerformanceMonitor();

      monitor.record({ operation: 'api.reports.get', durationMs: 50, success: true });
      monitor.record({ operation: 'api.reports.get', durationMs: 60, success: true });
      monitor.record({ operation: 'api.reports.get', durationMs: 55, success: true });

      const stats = monitor.getStats('api.reports.get');
      expect(stats.count).toBe(3);
      expect(stats.avgMs).toBeCloseTo(55, 0);
      expect(stats.successRate).toBe(1);
    });

    it('should calculate percentiles', () => {
      const monitor = new PerformanceMonitor();

      for (let i = 1; i <= 100; i++) {
        monitor.record({ operation: 'test', durationMs: i, success: true });
      }

      const stats = monitor.getStats('test');
      expect(stats.p50Ms).toBeCloseTo(50, 5);
      expect(stats.p95Ms).toBeCloseTo(95, 5);
    });

    it('should track success rate', () => {
      const monitor = new PerformanceMonitor();

      monitor.record({ operation: 'test', durationMs: 10, success: true });
      monitor.record({ operation: 'test', durationMs: 10, success: true });
      monitor.record({ operation: 'test', durationMs: 10, success: false });
      monitor.record({ operation: 'test', durationMs: 10, success: true });

      const stats = monitor.getStats('test');
      expect(stats.successRate).toBe(0.75);
    });
  });

  describe('Reliability Features', () => {
    it('should retry failed operations', async () => {
      let attempts = 0;

      const result = await withRetry(
        async () => {
          attempts++;
          if (attempts < 3) throw new Error('Temporary failure');
          return 'success';
        },
        { maxRetries: 3, baseDelayMs: 10 }
      );

      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });

    it('should respect max retries', async () => {
      let attempts = 0;

      await expect(
        withRetry(
          async () => {
            attempts++;
            throw new Error('Permanent failure');
          },
          { maxRetries: 2, baseDelayMs: 10 }
        )
      ).rejects.toThrow('Permanent failure');

      expect(attempts).toBe(3); // Initial + 2 retries
    });

    it('should open circuit after failures', async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 100 });

      // First failure
      await expect(breaker.execute(async () => { throw new Error('fail'); })).rejects.toThrow();
      expect(breaker.getState()).toBe('closed');

      // Second failure - should open
      await expect(breaker.execute(async () => { throw new Error('fail'); })).rejects.toThrow();
      expect(breaker.getState()).toBe('open');

      // Should reject immediately when open
      await expect(breaker.execute(async () => 'success')).rejects.toThrow('Circuit breaker is open');
    });

    it('should reset circuit after success', async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 10 });

      // Open the circuit
      await expect(breaker.execute(async () => { throw new Error('fail'); })).rejects.toThrow();
      await expect(breaker.execute(async () => { throw new Error('fail'); })).rejects.toThrow();
      expect(breaker.getState()).toBe('open');

      // Wait for reset timeout
      await new Promise(r => setTimeout(r, 20));

      // Should succeed and close
      const result = await breaker.execute(async () => 'success');
      expect(result).toBe('success');
      expect(breaker.getState()).toBe('closed');
    });
  });

  describe('Integrated Cross-Cutting System', () => {
    it('should create integrated system', () => {
      const system = createCrossCuttingSystem(db);

      expect(system.pii).toBeInstanceOf(PIIDetector);
      expect(system.audit).toBeInstanceOf(AuditLogger);
      expect(system.performance).toBeInstanceOf(PerformanceMonitor);
      expect(system.health).toBeDefined();
    });

    it('should run health checks', async () => {
      const system = createCrossCuttingSystem(db);

      const status = await system.health.checkAll();
      expect(status.healthy).toBe(true);
      expect(status.checks.some(c => c.name === 'database')).toBe(true);
    });
  });
});
