/**
 * Error Alerting System for Ronald-GI
 *
 * Provides:
 * 1. Alert aggregation (don't spam with same errors)
 * 2. Severity-based routing
 * 3. Multiple notification channels (macOS, webhook, file)
 * 4. Alert suppression and rate limiting
 * 5. Incident tracking and resolution
 */

import Database from 'better-sqlite3';
import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, appendFileSync } from 'fs';

const execAsync = promisify(exec);

// ============================================
// TYPES
// ============================================

export type AlertSeverity = 'critical' | 'error' | 'warning' | 'info';

export interface Alert {
  id: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  source: string;
  tags: string[];
  timestamp: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  resolved: boolean;
  resolvedAt?: string;
  metadata?: Record<string, any>;
}

export interface AlertRule {
  id: string;
  name: string;
  condition: (metrics: AlertMetrics) => boolean;
  severity: AlertSeverity;
  title: string;
  messageTemplate: string;
  cooldownMinutes: number;
  enabled: boolean;
}

export interface AlertMetrics {
  errorRate: number; // errors per minute
  p95Latency: number; // milliseconds
  memoryUsageMb: number;
  queueDepth: number;
  consecutiveFailures: number;
  lastSuccessMinutesAgo: number;
}

export interface NotificationChannel {
  name: string;
  enabled: boolean;
  minSeverity: AlertSeverity;
  notify: (alert: Alert) => Promise<boolean>;
}

// ============================================
// NOTIFICATION CHANNELS
// ============================================

/**
 * macOS Notification Center channel
 */
export class MacOSNotificationChannel implements NotificationChannel {
  name = 'macos';
  enabled = process.platform === 'darwin';
  minSeverity: AlertSeverity = 'warning';

  async notify(alert: Alert): Promise<boolean> {
    if (!this.enabled) return false;

    const title = `Ronald-GI: ${alert.severity.toUpperCase()}`;
    const message = `${alert.title}\n${alert.message}`.replace(/"/g, '\\"');

    try {
      await execAsync(
        `osascript -e 'display notification "${message}" with title "${title}" sound name "Glass"'`
      );
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Webhook notification channel (for Slack, Discord, etc.)
 */
export class WebhookNotificationChannel implements NotificationChannel {
  name = 'webhook';
  enabled = false;
  minSeverity: AlertSeverity = 'error';
  private webhookUrl?: string;

  configure(url: string): void {
    this.webhookUrl = url;
    this.enabled = true;
  }

  async notify(alert: Alert): Promise<boolean> {
    if (!this.enabled || !this.webhookUrl) return false;

    const severityEmoji: Record<AlertSeverity, string> = {
      critical: '🔴',
      error: '🟠',
      warning: '🟡',
      info: '🔵',
    };

    const payload = {
      text: `${severityEmoji[alert.severity]} **${alert.title}**`,
      attachments: [
        {
          color: alert.severity === 'critical' ? '#ff0000' : alert.severity === 'error' ? '#ff8800' : '#ffcc00',
          fields: [
            { title: 'Severity', value: alert.severity, short: true },
            { title: 'Source', value: alert.source, short: true },
            { title: 'Message', value: alert.message },
            { title: 'Count', value: String(alert.count), short: true },
            { title: 'Time', value: alert.timestamp, short: true },
          ],
        },
      ],
    };

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

/**
 * File-based alert log channel
 */
export class FileNotificationChannel implements NotificationChannel {
  name = 'file';
  enabled = true;
  minSeverity: AlertSeverity = 'info';
  private logPath: string;

  constructor(logPath: string = '/app/data/logs/alerts.log') {
    this.logPath = logPath;
  }

  async notify(alert: Alert): Promise<boolean> {
    const line = JSON.stringify({
      ...alert,
      logged_at: new Date().toISOString(),
    }) + '\n';

    try {
      appendFileSync(this.logPath, line);
      return true;
    } catch {
      return false;
    }
  }
}

// ============================================
// ALERT MANAGER
// ============================================

export class AlertManager {
  private alerts: Map<string, Alert> = new Map();
  private channels: NotificationChannel[] = [];
  private rules: AlertRule[] = [];
  private suppressedUntil: Map<string, Date> = new Map();
  private lastCheck = Date.now();

  constructor(private db?: Database.Database) {
    // Default channels
    this.channels.push(new MacOSNotificationChannel());
    this.channels.push(new FileNotificationChannel());

    // Initialize default rules
    this.initDefaultRules();

    if (db) {
      this.ensureTables();
      this.loadPersistedAlerts();
    }
  }

  private ensureTables(): void {
    if (!this.db) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS system_alerts (
        id TEXT PRIMARY KEY,
        severity TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        source TEXT NOT NULL,
        tags_json TEXT DEFAULT '[]',
        count INTEGER DEFAULT 1,
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        resolved INTEGER DEFAULT 0,
        resolved_at TEXT,
        metadata_json TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_alerts_severity ON system_alerts(severity);
      CREATE INDEX IF NOT EXISTS idx_alerts_resolved ON system_alerts(resolved);
      CREATE INDEX IF NOT EXISTS idx_alerts_source ON system_alerts(source);
    `);
  }

  private loadPersistedAlerts(): void {
    if (!this.db) return;
    try {
      const rows = this.db.prepare(
        'SELECT * FROM system_alerts WHERE resolved = 0'
      ).all() as any[];

      for (const row of rows) {
        const alert: Alert = {
          id: row.id,
          severity: row.severity,
          title: row.title,
          message: row.message,
          source: row.source,
          tags: JSON.parse(row.tags_json || '[]'),
          timestamp: row.last_seen,
          count: row.count,
          firstSeen: row.first_seen,
          lastSeen: row.last_seen,
          resolved: row.resolved === 1,
          resolvedAt: row.resolved_at,
          metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
        };
        this.alerts.set(alert.id, alert);
      }
    } catch {}
  }

  private initDefaultRules(): void {
    this.rules = [
      {
        id: 'high-error-rate',
        name: 'High Error Rate',
        condition: (m) => m.errorRate > 10,
        severity: 'critical',
        title: 'High Error Rate Detected',
        messageTemplate: 'Error rate: {errorRate}/min exceeds threshold',
        cooldownMinutes: 15,
        enabled: true,
      },
      {
        id: 'slow-responses',
        name: 'Slow Response Times',
        condition: (m) => m.p95Latency > 5000,
        severity: 'warning',
        title: 'Slow Response Times',
        messageTemplate: 'P95 latency: {p95Latency}ms exceeds 5s threshold',
        cooldownMinutes: 30,
        enabled: true,
      },
      {
        id: 'high-memory',
        name: 'High Memory Usage',
        condition: (m) => m.memoryUsageMb > 1024,
        severity: 'warning',
        title: 'High Memory Usage',
        messageTemplate: 'Memory usage: {memoryUsageMb}MB exceeds 1GB threshold',
        cooldownMinutes: 60,
        enabled: true,
      },
      {
        id: 'queue-backup',
        name: 'Queue Backup',
        condition: (m) => m.queueDepth > 100,
        severity: 'warning',
        title: 'Job Queue Backing Up',
        messageTemplate: 'Queue depth: {queueDepth} jobs pending',
        cooldownMinutes: 15,
        enabled: true,
      },
      {
        id: 'consecutive-failures',
        name: 'Consecutive Failures',
        condition: (m) => m.consecutiveFailures >= 5,
        severity: 'error',
        title: 'Multiple Consecutive Failures',
        messageTemplate: '{consecutiveFailures} consecutive failures detected',
        cooldownMinutes: 10,
        enabled: true,
      },
      {
        id: 'stale-success',
        name: 'No Recent Successes',
        condition: (m) => m.lastSuccessMinutesAgo > 60,
        severity: 'error',
        title: 'No Successful Operations',
        messageTemplate: 'Last success was {lastSuccessMinutesAgo} minutes ago',
        cooldownMinutes: 30,
        enabled: true,
      },
    ];
  }

  /**
   * Add a notification channel
   */
  addChannel(channel: NotificationChannel): void {
    this.channels.push(channel);
  }

  /**
   * Add a custom alert rule
   */
  addRule(rule: AlertRule): void {
    this.rules.push(rule);
  }

  /**
   * Create or update an alert
   */
  async alert(
    severity: AlertSeverity,
    title: string,
    message: string,
    source: string,
    options: {
      tags?: string[];
      metadata?: Record<string, any>;
      aggregate?: boolean;
    } = {}
  ): Promise<string> {
    const aggregateKey = options.aggregate !== false
      ? `${severity}:${source}:${title}`
      : this.randomId();

    const now = new Date().toISOString();
    const existing = this.alerts.get(aggregateKey);

    let alert: Alert;
    if (existing && options.aggregate !== false) {
      // Update existing alert
      alert = {
        ...existing,
        message,
        lastSeen: now,
        timestamp: now,
        count: existing.count + 1,
        metadata: { ...existing.metadata, ...options.metadata },
      };
    } else {
      // Create new alert
      alert = {
        id: aggregateKey,
        severity,
        title,
        message,
        source,
        tags: options.tags || [],
        timestamp: now,
        count: 1,
        firstSeen: now,
        lastSeen: now,
        resolved: false,
        metadata: options.metadata,
      };
    }

    this.alerts.set(alert.id, alert);
    this.persistAlert(alert);

    // Notify if not suppressed
    if (!this.isSuppressed(alert.id)) {
      await this.notify(alert);
    }

    return alert.id;
  }

  /**
   * Resolve an alert
   */
  resolve(alertId: string): void {
    const alert = this.alerts.get(alertId);
    if (alert) {
      alert.resolved = true;
      alert.resolvedAt = new Date().toISOString();
      this.persistAlert(alert);
    }
  }

  /**
   * Suppress an alert for a duration
   */
  suppress(alertId: string, durationMinutes: number): void {
    const until = new Date(Date.now() + durationMinutes * 60000);
    this.suppressedUntil.set(alertId, until);
  }

  private isSuppressed(alertId: string): boolean {
    const until = this.suppressedUntil.get(alertId);
    if (!until) return false;
    if (until < new Date()) {
      this.suppressedUntil.delete(alertId);
      return false;
    }
    return true;
  }

  /**
   * Check metrics against rules
   */
  async checkRules(metrics: AlertMetrics): Promise<Alert[]> {
    const triggered: Alert[] = [];

    for (const rule of this.rules) {
      if (!rule.enabled) continue;

      // Check cooldown
      if (this.isSuppressed(rule.id)) continue;

      if (rule.condition(metrics)) {
        const message = rule.messageTemplate.replace(
          /\{(\w+)\}/g,
          (_, key) => String((metrics as any)[key] ?? '')
        );

        const alertId = await this.alert(
          rule.severity,
          rule.title,
          message,
          'rule-engine',
          { tags: ['automated'], metadata: { ruleId: rule.id, metrics } }
        );

        // Apply cooldown
        this.suppress(rule.id, rule.cooldownMinutes);

        const alert = this.alerts.get(alertId);
        if (alert) triggered.push(alert);
      }
    }

    return triggered;
  }

  /**
   * Get current alerts
   */
  getAlerts(options: {
    severity?: AlertSeverity;
    resolved?: boolean;
    source?: string;
    limit?: number;
  } = {}): Alert[] {
    let alerts = Array.from(this.alerts.values());

    if (options.severity) {
      alerts = alerts.filter(a => a.severity === options.severity);
    }
    if (options.resolved !== undefined) {
      alerts = alerts.filter(a => a.resolved === options.resolved);
    }
    if (options.source) {
      alerts = alerts.filter(a => a.source === options.source);
    }

    // Sort by severity, then by timestamp
    const severityOrder: Record<AlertSeverity, number> = {
      critical: 0,
      error: 1,
      warning: 2,
      info: 3,
    };

    alerts.sort((a, b) => {
      const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
      if (severityDiff !== 0) return severityDiff;
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });

    return options.limit ? alerts.slice(0, options.limit) : alerts;
  }

  /**
   * Get alert statistics
   */
  getStats(): {
    total: number;
    bySeverity: Record<AlertSeverity, number>;
    unresolved: number;
    last24h: number;
  } {
    const alerts = Array.from(this.alerts.values());
    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;

    return {
      total: alerts.length,
      bySeverity: {
        critical: alerts.filter(a => a.severity === 'critical').length,
        error: alerts.filter(a => a.severity === 'error').length,
        warning: alerts.filter(a => a.severity === 'warning').length,
        info: alerts.filter(a => a.severity === 'info').length,
      },
      unresolved: alerts.filter(a => !a.resolved).length,
      last24h: alerts.filter(a => new Date(a.timestamp).getTime() > dayAgo).length,
    };
  }

  private async notify(alert: Alert): Promise<void> {
    const severityLevel: Record<AlertSeverity, number> = {
      critical: 0,
      error: 1,
      warning: 2,
      info: 3,
    };

    for (const channel of this.channels) {
      if (!channel.enabled) continue;

      const minLevel = severityLevel[channel.minSeverity];
      const alertLevel = severityLevel[alert.severity];

      if (alertLevel <= minLevel) {
        try {
          await channel.notify(alert);
        } catch (error) {
          console.error(`Failed to notify via ${channel.name}:`, error);
        }
      }
    }
  }

  private persistAlert(alert: Alert): void {
    if (!this.db) return;

    try {
      this.db.prepare(`
        INSERT INTO system_alerts
        (id, severity, title, message, source, tags_json, count, first_seen, last_seen, resolved, resolved_at, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          count = excluded.count,
          last_seen = excluded.last_seen,
          resolved = excluded.resolved,
          resolved_at = excluded.resolved_at,
          metadata_json = excluded.metadata_json
      `).run(
        alert.id,
        alert.severity,
        alert.title,
        alert.message,
        alert.source,
        JSON.stringify(alert.tags),
        alert.count,
        alert.firstSeen,
        alert.lastSeen,
        alert.resolved ? 1 : 0,
        alert.resolvedAt,
        alert.metadata ? JSON.stringify(alert.metadata) : null
      );
    } catch {}
  }

  private randomId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }
}

// ============================================
// METRICS COLLECTOR
// ============================================

export class MetricsCollector {
  private errorCounts: number[] = [];
  private latencies: number[] = [];
  private failureStreak = 0;
  private lastSuccess?: Date;
  private windowMinutes = 5;

  /**
   * Record an operation result
   */
  record(success: boolean, latencyMs?: number): void {
    const now = Date.now();

    // Track errors
    if (!success) {
      this.errorCounts.push(now);
      this.failureStreak++;
    } else {
      this.failureStreak = 0;
      this.lastSuccess = new Date();
    }

    // Track latency
    if (latencyMs !== undefined) {
      this.latencies.push(latencyMs);
    }

    // Cleanup old data
    this.cleanup();
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.windowMinutes * 60 * 1000;
    this.errorCounts = this.errorCounts.filter(t => t > cutoff);

    // Keep only last 1000 latencies
    if (this.latencies.length > 1000) {
      this.latencies = this.latencies.slice(-1000);
    }
  }

  /**
   * Get current metrics for alerting
   */
  getMetrics(): AlertMetrics {
    this.cleanup();

    const errorsInWindow = this.errorCounts.length;
    const errorRate = errorsInWindow / this.windowMinutes;

    // Calculate P95 latency
    let p95Latency = 0;
    if (this.latencies.length > 0) {
      const sorted = [...this.latencies].sort((a, b) => a - b);
      const p95Index = Math.floor(sorted.length * 0.95);
      p95Latency = sorted[p95Index] || 0;
    }

    // Memory usage
    const memoryUsageMb = process.memoryUsage().heapUsed / 1024 / 1024;

    // Time since last success
    const lastSuccessMinutesAgo = this.lastSuccess
      ? (Date.now() - this.lastSuccess.getTime()) / 60000
      : Infinity;

    return {
      errorRate,
      p95Latency,
      memoryUsageMb,
      queueDepth: 0, // Would be populated from job queue
      consecutiveFailures: this.failureStreak,
      lastSuccessMinutesAgo: Math.round(lastSuccessMinutesAgo),
    };
  }
}

// ============================================
// EXPORTS
// ============================================

export function createAlertingSystem(db?: Database.Database) {
  const manager = new AlertManager(db);
  const metrics = new MetricsCollector();

  return {
    manager,
    metrics,

    // Convenience methods
    alert: (
      severity: AlertSeverity,
      title: string,
      message: string,
      source: string
    ) => manager.alert(severity, title, message, source),

    checkHealth: async () => {
      const currentMetrics = metrics.getMetrics();
      return manager.checkRules(currentMetrics);
    },

    record: (success: boolean, latencyMs?: number) =>
      metrics.record(success, latencyMs),

    getAlerts: () => manager.getAlerts({ resolved: false }),

    getStats: () => manager.getStats(),
  };
}
