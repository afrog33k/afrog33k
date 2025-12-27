/**
 * Daily Briefing & Proactive Intelligence API Routes
 *
 * Endpoints:
 * - GET /briefing - Get today's daily briefing
 * - GET /briefing/alerts - Get pending alerts
 * - POST /briefing/alerts/:id/dismiss - Dismiss an alert
 * - GET /briefing/research-plan - Get planned research
 * - POST /briefing/research/execute - Execute next planned research
 * - POST /briefing/check-alerts - Manually trigger alert check
 */

import { FastifyInstance } from 'fastify';
import { createProactiveSystem } from '../lib/proactive';

export default async function briefingRoutes(fastify: FastifyInstance) {
  const db = (fastify as any).db;
  const proactive = createProactiveSystem(db);

  /**
   * GET /briefing - Get today's daily briefing
   *
   * This is the main endpoint that answers:
   * - What should I know today?
   * - What research did the system do?
   * - What should I look at?
   * - What are my trending interests?
   */
  fastify.get('/briefing', async (request, reply) => {
    try {
      const briefing = proactive.briefing.generate();
      return {
        success: true,
        briefing,
      };
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: 'Failed to generate briefing',
      });
    }
  });

  /**
   * GET /briefing/alerts - Get pending proactive alerts
   *
   * Returns alerts that need attention:
   * - Discovery spikes
   * - High-impact findings
   * - Research needing review
   */
  fastify.get('/briefing/alerts', async (request, reply) => {
    try {
      const alerts = proactive.alerts.getPendingAlerts();
      return {
        success: true,
        count: alerts.length,
        alerts,
      };
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: 'Failed to get alerts',
      });
    }
  });

  /**
   * POST /briefing/alerts/:id/dismiss - Dismiss an alert
   */
  fastify.post<{
    Params: { id: string }
  }>('/briefing/alerts/:id/dismiss', async (request, reply) => {
    try {
      proactive.alerts.dismiss(request.params.id);
      return { success: true };
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: 'Failed to dismiss alert',
      });
    }
  });

  /**
   * POST /briefing/check-alerts - Manually trigger alert check
   *
   * Useful for testing or forcing an alert refresh
   */
  fastify.post('/briefing/check-alerts', async (request, reply) => {
    try {
      const newAlerts = proactive.alerts.checkAndCreateAlerts();
      return {
        success: true,
        newAlerts: newAlerts.length,
        alerts: newAlerts,
      };
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: 'Failed to check alerts',
      });
    }
  });

  /**
   * GET /briefing/research-plan - Get planned research
   *
   * Shows what research the system plans to do:
   * - Topics based on your interests
   * - Discovery spikes to investigate
   * - Scheduled times and estimated costs
   */
  fastify.get('/briefing/research-plan', async (request, reply) => {
    try {
      const planned = proactive.planner.getPlannedResearch();
      return {
        success: true,
        count: planned.length,
        plans: planned,
      };
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: 'Failed to get research plan',
      });
    }
  });

  /**
   * POST /briefing/research-plan - Plan next research tasks
   *
   * Analyzes current interests and discovery spikes to plan research
   */
  fastify.post('/briefing/research-plan', async (request, reply) => {
    try {
      const plans = proactive.planner.planNextResearch();
      return {
        success: true,
        planned: plans.length,
        plans,
      };
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: 'Failed to plan research',
      });
    }
  });

  /**
   * POST /briefing/research/execute - Execute next planned research
   *
   * Kicks off the next highest-priority research task
   */
  fastify.post('/briefing/research/execute', async (request, reply) => {
    try {
      const jobId = await proactive.planner.executeNext();
      if (jobId) {
        return {
          success: true,
          message: 'Research job started',
          jobId,
        };
      } else {
        return {
          success: true,
          message: 'No research planned',
        };
      }
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: 'Failed to execute research',
      });
    }
  });

  /**
   * GET /briefing/insights - Get learning insights
   *
   * What has the system learned about your preferences?
   */
  fastify.get('/briefing/insights', async (request, reply) => {
    try {
      const briefing = proactive.briefing.generate();
      return {
        success: true,
        insights: briefing.learningInsights,
        trendingConcepts: briefing.trendingConcepts,
        stats: briefing.stats,
      };
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: 'Failed to get insights',
      });
    }
  });

  /**
   * GET /briefing/summary - Get a quick text summary for notifications
   */
  fastify.get('/briefing/summary', async (request, reply) => {
    try {
      const briefing = proactive.briefing.generate();

      const lines: string[] = [briefing.greeting];

      if (briefing.discoverySpikes.length > 0) {
        lines.push(`\n📊 ${briefing.discoverySpikes.length} discovery spike(s) detected`);
        lines.push(`   Top: ${briefing.discoverySpikes[0].topic} (${briefing.discoverySpikes[0].visitCount} visits)`);
      }

      if (briefing.topReports.length > 0) {
        lines.push(`\n📄 ${briefing.topReports.length} reports to review`);
        lines.push(`   Top: ${briefing.topReports[0].title}`);
      }

      if (briefing.suggestedActions.length > 0) {
        const urgent = briefing.suggestedActions.filter(a => a.priority === 'high');
        if (urgent.length > 0) {
          lines.push(`\n⚡ ${urgent.length} urgent action(s)`);
          lines.push(`   ${urgent[0].title}`);
        }
      }

      if (briefing.learningInsights.length > 0) {
        lines.push(`\n🧠 ${briefing.learningInsights.length} learning insight(s)`);
      }

      lines.push(`\n📈 Stats: ${briefing.stats.reportsGenerated24h} reports | ${briefing.stats.conceptsTracked} concepts`);

      return {
        success: true,
        summary: lines.join('\n'),
      };
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: 'Failed to generate summary',
      });
    }
  });
}
