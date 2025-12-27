/**
 * Proactive Intelligence Layer for Ronald-GI
 *
 * This is the HEART of what makes Ronald useful:
 * - Daily briefings on what matters
 * - Discovery spike alerts when you're onto something
 * - Research summaries of what the system learned
 * - Action recommendations based on your patterns
 *
 * "The system that watches you learn, tells you what you need to know."
 */

import Database from 'better-sqlite3';

// ============================================
// DAILY BRIEFING SYSTEM
// ============================================

export interface DailyBriefing {
  date: string;
  greeting: string;

  // What's hot right now
  discoverySpikes: DiscoverySpike[];

  // What you should look at today
  topReports: BriefingReport[];

  // Research the system did overnight
  overnightResearch: ResearchSummary[];

  // Concepts trending in your interests
  trendingConcepts: TrendingConcept[];

  // Actions you might want to take
  suggestedActions: SuggestedAction[];

  // Learning insights
  learningInsights: LearningInsight[];

  // Quick stats
  stats: BriefingStats;
}

export interface DiscoverySpike {
  id: string;
  topic: string;
  intensity: number;
  visitCount: number;
  timeWindow: string;
  relatedConcepts: string[];
  suggestedAction: string;
}

export interface BriefingReport {
  id: string;
  title: string;
  type: string;
  summary: string;
  relevanceScore: number;
  concepts: string[];
  whyShowing: string;  // "Matches your interest in X" or "New in your field"
}

export interface ResearchSummary {
  id: string;
  topic: string;
  findingsCount: number;
  keyInsight: string;
  confidence: number;
  sourceCount: number;
  generatedAt: string;
}

export interface TrendingConcept {
  label: string;
  trend: 'rising' | 'hot' | 'cooling';
  changePercent: number;
  mentionCount: number;
  topSource: string;
}

export interface SuggestedAction {
  id: string;
  type: 'read' | 'research' | 'connect' | 'test' | 'review';
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  reason: string;
  targetId?: string;
  targetType?: string;
}

export interface LearningInsight {
  type: 'preference_shift' | 'new_interest' | 'fading_interest' | 'pattern_detected';
  title: string;
  description: string;
  evidence: string[];
}

export interface BriefingStats {
  reportsGenerated24h: number;
  conceptsTracked: number;
  sourcesMonitored: number;
  totalResearchHours: number;
  satisfactionTrend: 'improving' | 'stable' | 'declining';
}

/**
 * Generates daily briefings based on user activity and system learning
 */
export class DailyBriefingGenerator {
  constructor(private db: Database.Database) {}

  /**
   * Generate today's briefing
   */
  generate(): DailyBriefing {
    const now = new Date();
    const hour = now.getHours();

    return {
      date: now.toISOString().split('T')[0],
      greeting: this.getGreeting(hour),
      discoverySpikes: this.getDiscoverySpikes(),
      topReports: this.getTopReports(),
      overnightResearch: this.getOvernightResearch(),
      trendingConcepts: this.getTrendingConcepts(),
      suggestedActions: this.getSuggestedActions(),
      learningInsights: this.getLearningInsights(),
      stats: this.getStats(),
    };
  }

  private getGreeting(hour: number): string {
    const obsessions = this.getTopObsessions(3);
    const obsessionStr = obsessions.length > 0
      ? ` You've been deep into ${obsessions.join(', ')}.`
      : '';

    if (hour < 12) {
      return `Good morning.${obsessionStr}`;
    } else if (hour < 17) {
      return `Good afternoon.${obsessionStr}`;
    } else {
      return `Good evening.${obsessionStr}`;
    }
  }

  private getTopObsessions(limit: number): string[] {
    try {
      const results = this.db.prepare(`
        SELECT c.label
        FROM preference_weights pw
        JOIN concepts c ON pw.target_id = c.id
        WHERE pw.weight_type = 'concept' AND c.active = 1
        ORDER BY pw.weight DESC
        LIMIT ?
      `).all(limit) as any[];
      return results.map(r => r.label);
    } catch {
      return [];
    }
  }

  /**
   * Detect discovery spikes - bursts of related browsing activity
   */
  private getDiscoverySpikes(): DiscoverySpike[] {
    try {
      // Find clusters of visits in short time windows
      const spikes = this.db.prepare(`
        SELECT
          v.cluster_id,
          COUNT(*) as visit_count,
          GROUP_CONCAT(DISTINCT v.host) as hosts,
          MIN(v.visited_at) as start_time,
          MAX(v.visited_at) as end_time
        FROM visits v
        WHERE v.visited_at > datetime('now', '-24 hours')
          AND v.cluster_id IS NOT NULL
        GROUP BY v.cluster_id
        HAVING visit_count >= 3
        ORDER BY visit_count DESC
        LIMIT 5
      `).all() as any[];

      return spikes.map((s, i) => {
        // Get concepts for this cluster
        const concepts = this.getClusterConcepts(s.cluster_id);
        const intensity = Math.min(1, s.visit_count / 10);

        return {
          id: `spike_${s.cluster_id}`,
          topic: concepts[0] || `Research cluster ${i + 1}`,
          intensity,
          visitCount: s.visit_count,
          timeWindow: this.formatTimeWindow(s.start_time, s.end_time),
          relatedConcepts: concepts.slice(0, 5),
          suggestedAction: intensity > 0.7
            ? 'Deep dive recommended - you seem very interested'
            : 'Worth exploring further',
        };
      });
    } catch {
      return [];
    }
  }

  private getClusterConcepts(clusterId: string): string[] {
    try {
      const results = this.db.prepare(`
        SELECT DISTINCT c.label
        FROM visits v
        JOIN sources s ON v.url = s.url
        JOIN concept_mentions cm ON cm.entity_id = s.id AND cm.entity_type = 'source'
        JOIN concepts c ON cm.concept_id = c.id
        WHERE v.cluster_id = ? AND c.active = 1
        LIMIT 10
      `).all(clusterId) as any[];
      return results.map(r => r.label);
    } catch {
      return [];
    }
  }

  private formatTimeWindow(start: string, end: string): string {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const diffMs = endDate.getTime() - startDate.getTime();
    const diffMins = Math.round(diffMs / 60000);

    if (diffMins < 60) return `${diffMins} minutes`;
    if (diffMins < 1440) return `${Math.round(diffMins / 60)} hours`;
    return `${Math.round(diffMins / 1440)} days`;
  }

  /**
   * Get top reports you should see today
   */
  private getTopReports(): BriefingReport[] {
    try {
      const reports = this.db.prepare(`
        SELECT
          r.id,
          r.title,
          r.type,
          r.summary,
          r.impact_score,
          r.novelty_score,
          r.created_at,
          (r.impact_score * 0.4 + r.novelty_score * 0.3 +
           CASE WHEN r.pinned = 1 THEN 0.3 ELSE 0 END) as relevance_score
        FROM reports r
        WHERE r.promoted = 1
          AND r.created_at > datetime('now', '-7 days')
        ORDER BY relevance_score DESC
        LIMIT 5
      `).all() as any[];

      return reports.map(r => {
        const concepts = this.getReportConcepts(r.id);
        return {
          id: r.id,
          title: r.title,
          type: r.type,
          summary: r.summary || 'No summary available',
          relevanceScore: r.relevance_score,
          concepts,
          whyShowing: this.explainWhyShowing(r, concepts),
        };
      });
    } catch {
      return [];
    }
  }

  private getReportConcepts(reportId: string): string[] {
    try {
      const results = this.db.prepare(`
        SELECT c.label
        FROM concept_mentions cm
        JOIN concepts c ON cm.concept_id = c.id
        WHERE cm.entity_type = 'report' AND cm.entity_id = ?
          AND c.active = 1
        LIMIT 5
      `).all(reportId) as any[];
      return results.map(r => r.label);
    } catch {
      return [];
    }
  }

  private explainWhyShowing(report: any, concepts: string[]): string {
    const topObsessions = this.getTopObsessions(5);
    const matchingConcepts = concepts.filter(c => topObsessions.includes(c));

    if (matchingConcepts.length > 0) {
      return `Matches your interest in ${matchingConcepts[0]}`;
    }
    if (report.impact_score > 0.7) {
      return 'High impact discovery';
    }
    if (report.novelty_score > 0.7) {
      return 'Novel finding in your field';
    }
    return 'Recently generated';
  }

  /**
   * Get research the system did overnight
   */
  private getOvernightResearch(): ResearchSummary[] {
    try {
      const jobs = this.db.prepare(`
        SELECT
          jq.id,
          jq.payload_json,
          jq.completed_at,
          r.id as report_id,
          r.title,
          r.summary,
          r.impact_score
        FROM job_queue jq
        LEFT JOIN reports r ON json_extract(jq.result_json, '$.report_id') = r.id
        WHERE jq.status = 'completed'
          AND jq.completed_at > datetime('now', '-24 hours')
          AND jq.job_type = 'research'
        ORDER BY jq.completed_at DESC
        LIMIT 10
      `).all() as any[];

      return jobs.filter(j => j.report_id).map(j => ({
        id: j.report_id,
        topic: j.title || 'Research task',
        findingsCount: 1,
        keyInsight: j.summary || 'Research completed',
        confidence: j.impact_score || 0.5,
        sourceCount: 1,
        generatedAt: j.completed_at,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Get trending concepts based on recent activity
   */
  private getTrendingConcepts(): TrendingConcept[] {
    try {
      // Compare last 7 days to previous 7 days
      const trends = this.db.prepare(`
        WITH recent AS (
          SELECT concept_id, COUNT(*) as count
          FROM concept_mentions cm
          JOIN reports r ON cm.entity_id = r.id AND cm.entity_type = 'report'
          WHERE r.created_at > datetime('now', '-7 days')
          GROUP BY concept_id
        ),
        previous AS (
          SELECT concept_id, COUNT(*) as count
          FROM concept_mentions cm
          JOIN reports r ON cm.entity_id = r.id AND cm.entity_type = 'report'
          WHERE r.created_at BETWEEN datetime('now', '-14 days') AND datetime('now', '-7 days')
          GROUP BY concept_id
        )
        SELECT
          c.label,
          COALESCE(recent.count, 0) as recent_count,
          COALESCE(previous.count, 0) as prev_count,
          CASE
            WHEN COALESCE(previous.count, 0) = 0 THEN 100
            ELSE ((COALESCE(recent.count, 0) - COALESCE(previous.count, 0)) * 100.0 / previous.count)
          END as change_percent
        FROM concepts c
        LEFT JOIN recent ON c.id = recent.concept_id
        LEFT JOIN previous ON c.id = previous.concept_id
        WHERE c.active = 1
          AND (recent.count > 0 OR previous.count > 0)
        ORDER BY change_percent DESC
        LIMIT 10
      `).all() as any[];

      return trends.map(t => ({
        label: t.label,
        trend: t.change_percent > 50 ? 'rising' : t.change_percent > 0 ? 'hot' : 'cooling',
        changePercent: Math.round(t.change_percent),
        mentionCount: t.recent_count,
        topSource: '',  // Would need to join to get this
      }));
    } catch {
      return [];
    }
  }

  /**
   * Generate suggested actions based on current state
   */
  private getSuggestedActions(): SuggestedAction[] {
    const actions: SuggestedAction[] = [];

    // Check for unread high-impact reports
    try {
      const unread = this.db.prepare(`
        SELECT r.id, r.title, r.impact_score
        FROM reports r
        LEFT JOIN telemetry t ON r.id = t.report_id AND t.event_type = 'open'
        WHERE t.id IS NULL
          AND r.impact_score > 0.7
          AND r.created_at > datetime('now', '-3 days')
        LIMIT 3
      `).all() as any[];

      for (const r of unread) {
        actions.push({
          id: `read_${r.id}`,
          type: 'read',
          title: `Read: ${r.title}`,
          description: 'High-impact report you haven\'t seen yet',
          priority: 'high',
          reason: `Impact score: ${(r.impact_score * 100).toFixed(0)}%`,
          targetId: r.id,
          targetType: 'report',
        });
      }
    } catch {}

    // Check for repos that should be tested
    try {
      const testCandidates = this.db.prepare(`
        SELECT r.id, r.title, s.url
        FROM reports r
        JOIN sources s ON r.source_id = s.id
        WHERE r.type = 'repo_signal'
          AND r.impact_score > 0.6
          AND s.url LIKE '%github.com%'
          AND r.id NOT IN (SELECT DISTINCT json_extract(payload_json, '$.report_id') FROM job_queue WHERE job_type = 'test_repo')
        LIMIT 2
      `).all() as any[];

      for (const r of testCandidates) {
        actions.push({
          id: `test_${r.id}`,
          type: 'test',
          title: `Test: ${r.title}`,
          description: 'Run tests on this promising repo',
          priority: 'medium',
          reason: 'High interest, not yet validated',
          targetId: r.id,
          targetType: 'report',
        });
      }
    } catch {}

    // Check for concepts that might need review
    try {
      const staleHighWeight = this.db.prepare(`
        SELECT c.label, pw.weight, pw.last_engagement_at
        FROM preference_weights pw
        JOIN concepts c ON pw.target_id = c.id
        WHERE pw.weight_type = 'concept'
          AND pw.weight > 1.2
          AND pw.last_engagement_at < datetime('now', '-14 days')
        LIMIT 2
      `).all() as any[];

      for (const c of staleHighWeight) {
        actions.push({
          id: `review_${c.label}`,
          type: 'review',
          title: `Review interest: ${c.label}`,
          description: 'Still interested? No activity in 2 weeks',
          priority: 'low',
          reason: 'High weight but no recent engagement',
        });
      }
    } catch {}

    return actions.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  /**
   * Get learning insights - what the system learned about you
   */
  private getLearningInsights(): LearningInsight[] {
    const insights: LearningInsight[] = [];

    // Detect preference shifts
    try {
      const shifts = this.db.prepare(`
        SELECT c.label, pw.weight,
          (SELECT AVG(weight) FROM preference_weights WHERE weight_type = 'concept') as avg_weight
        FROM preference_weights pw
        JOIN concepts c ON pw.target_id = c.id
        WHERE pw.weight_type = 'concept'
          AND pw.last_engagement_at > datetime('now', '-7 days')
          AND pw.weight > 1.3
        ORDER BY pw.weight DESC
        LIMIT 3
      `).all() as any[];

      if (shifts.length > 0) {
        insights.push({
          type: 'preference_shift',
          title: 'Your focus is shifting',
          description: `You're spending more time on ${shifts.map(s => s.label).join(', ')}`,
          evidence: shifts.map(s => `${s.label}: weight ${s.weight.toFixed(2)}`),
        });
      }
    } catch {}

    // Detect new interests
    try {
      const newInterests = this.db.prepare(`
        SELECT c.label, COUNT(*) as engagement_count
        FROM concepts c
        JOIN concept_mentions cm ON c.id = cm.concept_id
        JOIN reports r ON cm.entity_id = r.id AND cm.entity_type = 'report'
        JOIN telemetry t ON r.id = t.report_id
        LEFT JOIN preference_weights pw ON pw.target_id = c.id AND pw.weight_type = 'concept'
        WHERE c.active = 1
          AND t.created_at > datetime('now', '-7 days')
          AND (pw.id IS NULL OR pw.weight < 1.0)
        GROUP BY c.id
        HAVING engagement_count >= 3
        LIMIT 3
      `).all() as any[];

      if (newInterests.length > 0) {
        insights.push({
          type: 'new_interest',
          title: 'Emerging interests detected',
          description: `You seem to be developing interest in: ${newInterests.map(n => n.label).join(', ')}`,
          evidence: newInterests.map(n => `${n.label}: ${n.engagement_count} engagements this week`),
        });
      }
    } catch {}

    return insights;
  }

  /**
   * Get quick stats for the briefing
   */
  private getStats(): BriefingStats {
    try {
      const reports24h = this.db.prepare(`
        SELECT COUNT(*) as count FROM reports
        WHERE created_at > datetime('now', '-24 hours')
      `).get() as any;

      const concepts = this.db.prepare(`
        SELECT COUNT(*) as count FROM concepts WHERE active = 1
      `).get() as any;

      const sources = this.db.prepare(`
        SELECT COUNT(*) as count FROM sources
      `).get() as any;

      // Estimate research hours from job queue
      const jobs = this.db.prepare(`
        SELECT COUNT(*) as count FROM job_queue
        WHERE status = 'completed' AND completed_at > datetime('now', '-24 hours')
      `).get() as any;

      return {
        reportsGenerated24h: reports24h?.count || 0,
        conceptsTracked: concepts?.count || 0,
        sourcesMonitored: sources?.count || 0,
        totalResearchHours: Math.round((jobs?.count || 0) * 0.5), // Estimate 30 min per job
        satisfactionTrend: 'stable',
      };
    } catch {
      return {
        reportsGenerated24h: 0,
        conceptsTracked: 0,
        sourcesMonitored: 0,
        totalResearchHours: 0,
        satisfactionTrend: 'stable',
      };
    }
  }
}

// ============================================
// PROACTIVE ALERT SYSTEM
// ============================================

export interface ProactiveAlert {
  id: string;
  type: 'discovery_spike' | 'high_impact' | 'action_needed' | 'learning_insight';
  priority: 'urgent' | 'important' | 'informational';
  title: string;
  message: string;
  createdAt: string;
  actionUrl?: string;
  dismissed: boolean;
}

export class ProactiveAlertManager {
  constructor(private db: Database.Database) {
    this.ensureTable();
  }

  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS proactive_alerts (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        priority TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        action_url TEXT,
        dismissed INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
  }

  /**
   * Check for conditions that warrant alerts
   */
  checkAndCreateAlerts(): ProactiveAlert[] {
    const alerts: ProactiveAlert[] = [];

    // Check for discovery spikes
    alerts.push(...this.checkDiscoverySpikes());

    // Check for high-impact findings
    alerts.push(...this.checkHighImpactFindings());

    // Check for stale research
    alerts.push(...this.checkStaleResearch());

    // Save new alerts
    for (const alert of alerts) {
      this.saveAlert(alert);
    }

    return alerts;
  }

  private checkDiscoverySpikes(): ProactiveAlert[] {
    try {
      const spikes = this.db.prepare(`
        SELECT
          v.cluster_id,
          COUNT(*) as visit_count,
          GROUP_CONCAT(DISTINCT v.host) as hosts
        FROM visits v
        WHERE v.visited_at > datetime('now', '-1 hour')
          AND v.cluster_id IS NOT NULL
        GROUP BY v.cluster_id
        HAVING visit_count >= 5
      `).all() as any[];

      return spikes.map(s => ({
        id: this.randomId(),
        type: 'discovery_spike' as const,
        priority: 'important' as const,
        title: 'Discovery spike detected',
        message: `You've visited ${s.visit_count} related pages in the last hour. Want me to research this topic?`,
        createdAt: new Date().toISOString(),
        dismissed: false,
      }));
    } catch {
      return [];
    }
  }

  private checkHighImpactFindings(): ProactiveAlert[] {
    try {
      const findings = this.db.prepare(`
        SELECT r.id, r.title, r.impact_score
        FROM reports r
        LEFT JOIN proactive_alerts pa ON pa.action_url LIKE '%' || r.id || '%'
        WHERE r.impact_score > 0.85
          AND r.created_at > datetime('now', '-6 hours')
          AND pa.id IS NULL
        LIMIT 3
      `).all() as any[];

      return findings.map(f => ({
        id: this.randomId(),
        type: 'high_impact' as const,
        priority: 'urgent' as const,
        title: 'High-impact discovery',
        message: f.title,
        createdAt: new Date().toISOString(),
        actionUrl: `/reports/${f.id}`,
        dismissed: false,
      }));
    } catch {
      return [];
    }
  }

  private checkStaleResearch(): ProactiveAlert[] {
    try {
      const stale = this.db.prepare(`
        SELECT pw.target_id, c.label, pw.weight, pw.last_engagement_at
        FROM preference_weights pw
        JOIN concepts c ON pw.target_id = c.id
        WHERE pw.weight_type = 'concept'
          AND pw.weight > 1.5
          AND pw.last_engagement_at < datetime('now', '-7 days')
        LIMIT 1
      `).all() as any[];

      return stale.map(s => ({
        id: this.randomId(),
        type: 'action_needed' as const,
        priority: 'informational' as const,
        title: 'Research getting stale',
        message: `No activity on "${s.label}" in 7 days. Still interested?`,
        createdAt: new Date().toISOString(),
        dismissed: false,
      }));
    } catch {
      return [];
    }
  }

  private saveAlert(alert: ProactiveAlert): void {
    try {
      this.db.prepare(`
        INSERT INTO proactive_alerts (id, type, priority, title, message, action_url, dismissed)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(alert.id, alert.type, alert.priority, alert.title, alert.message, alert.actionUrl || null, 0);
    } catch {}
  }

  /**
   * Get pending alerts
   */
  getPendingAlerts(): ProactiveAlert[] {
    try {
      const rows = this.db.prepare(`
        SELECT * FROM proactive_alerts
        WHERE dismissed = 0
        ORDER BY
          CASE priority WHEN 'urgent' THEN 0 WHEN 'important' THEN 1 ELSE 2 END,
          created_at DESC
        LIMIT 20
      `).all() as any[];

      return rows.map(r => ({
        id: r.id,
        type: r.type,
        priority: r.priority,
        title: r.title,
        message: r.message,
        createdAt: r.created_at,
        actionUrl: r.action_url,
        dismissed: r.dismissed === 1,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Dismiss an alert
   */
  dismiss(alertId: string): void {
    this.db.prepare(`UPDATE proactive_alerts SET dismissed = 1 WHERE id = ?`).run(alertId);
  }

  private randomId(): string {
    return Math.random().toString(36).substring(2, 15);
  }
}

// ============================================
// SCHEDULED RESEARCH PLANNER
// ============================================

export interface ResearchPlan {
  id: string;
  topic: string;
  priority: number;
  estimatedCost: number;
  estimatedTime: string;
  status: 'planned' | 'in_progress' | 'completed';
  scheduledFor: string;
  reason: string;
}

export class ResearchPlanner {
  constructor(private db: Database.Database) {
    this.ensureTable();
  }

  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS research_plans (
        id TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        priority INTEGER DEFAULT 5,
        estimated_cost REAL DEFAULT 0.1,
        estimated_time TEXT DEFAULT '30 minutes',
        status TEXT DEFAULT 'planned',
        scheduled_for TEXT,
        reason TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
  }

  /**
   * Plan research based on user interests and discovery spikes
   */
  planNextResearch(): ResearchPlan[] {
    const plans: ResearchPlan[] = [];

    // Plan research for high-weight concepts without recent reports
    try {
      const gaps = this.db.prepare(`
        SELECT c.id, c.label, pw.weight
        FROM preference_weights pw
        JOIN concepts c ON pw.target_id = c.id
        LEFT JOIN concept_mentions cm ON c.id = cm.concept_id AND cm.entity_type = 'report'
        LEFT JOIN reports r ON cm.entity_id = r.id AND r.created_at > datetime('now', '-7 days')
        WHERE pw.weight_type = 'concept'
          AND pw.weight > 1.0
          AND r.id IS NULL
        ORDER BY pw.weight DESC
        LIMIT 5
      `).all() as any[];

      for (const g of gaps) {
        plans.push({
          id: this.randomId(),
          topic: g.label,
          priority: Math.round(g.weight * 5),
          estimatedCost: 0.05,
          estimatedTime: '15 minutes',
          status: 'planned',
          scheduledFor: this.getNextSlot(),
          reason: `High interest (weight: ${g.weight.toFixed(2)}) but no recent research`,
        });
      }
    } catch {}

    // Plan research for discovery spikes
    try {
      const spikes = this.db.prepare(`
        SELECT
          vc.id,
          vc.label,
          COUNT(v.id) as visit_count
        FROM visit_clusters vc
        JOIN visits v ON v.cluster_id = vc.id
        WHERE v.visited_at > datetime('now', '-24 hours')
        GROUP BY vc.id
        HAVING visit_count >= 3
        ORDER BY visit_count DESC
        LIMIT 3
      `).all() as any[];

      for (const s of spikes) {
        plans.push({
          id: this.randomId(),
          topic: s.label || 'Discovery cluster',
          priority: 8,
          estimatedCost: 0.10,
          estimatedTime: '30 minutes',
          status: 'planned',
          scheduledFor: this.getNextSlot(),
          reason: `Discovery spike: ${s.visit_count} visits in 24h`,
        });
      }
    } catch {}

    // Save plans
    for (const plan of plans) {
      this.savePlan(plan);
    }

    return plans;
  }

  private getNextSlot(): string {
    // Schedule for next available slot (e.g., overnight)
    const now = new Date();
    const nextSlot = new Date(now);
    nextSlot.setHours(2, 0, 0, 0); // 2 AM
    if (nextSlot < now) {
      nextSlot.setDate(nextSlot.getDate() + 1);
    }
    return nextSlot.toISOString();
  }

  private savePlan(plan: ResearchPlan): void {
    try {
      this.db.prepare(`
        INSERT OR REPLACE INTO research_plans
        (id, topic, priority, estimated_cost, estimated_time, status, scheduled_for, reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        plan.id, plan.topic, plan.priority, plan.estimatedCost,
        plan.estimatedTime, plan.status, plan.scheduledFor, plan.reason
      );
    } catch {}
  }

  /**
   * Get planned research
   */
  getPlannedResearch(): ResearchPlan[] {
    try {
      const rows = this.db.prepare(`
        SELECT * FROM research_plans
        WHERE status = 'planned'
        ORDER BY priority DESC, scheduled_for ASC
      `).all() as any[];

      return rows.map(r => ({
        id: r.id,
        topic: r.topic,
        priority: r.priority,
        estimatedCost: r.estimated_cost,
        estimatedTime: r.estimated_time,
        status: r.status,
        scheduledFor: r.scheduled_for,
        reason: r.reason,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Execute next planned research
   */
  async executeNext(): Promise<string | null> {
    const next = this.db.prepare(`
      SELECT * FROM research_plans
      WHERE status = 'planned'
      ORDER BY priority DESC
      LIMIT 1
    `).get() as any;

    if (!next) return null;

    // Mark as in progress
    this.db.prepare(`UPDATE research_plans SET status = 'in_progress' WHERE id = ?`).run(next.id);

    // Create job in queue
    const jobId = this.randomId();
    this.db.prepare(`
      INSERT INTO job_queue (id, job_type, payload_json, priority)
      VALUES (?, 'research', ?, ?)
    `).run(jobId, JSON.stringify({ topic: next.topic, plan_id: next.id }), next.priority);

    return jobId;
  }

  private randomId(): string {
    return Math.random().toString(36).substring(2, 15);
  }
}

// ============================================
// EXPORTS
// ============================================

export function createProactiveSystem(db: Database.Database) {
  return {
    briefing: new DailyBriefingGenerator(db),
    alerts: new ProactiveAlertManager(db),
    planner: new ResearchPlanner(db),
  };
}
