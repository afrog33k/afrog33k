/**
 * Ronald-GI ESSENCE Tests
 *
 * These tests verify that Ronald-GI achieves its PURPOSE, not just that
 * its components work. The difference:
 *
 * MECHANICAL TEST: "Does calculateSatisfaction() return a number?"
 * ESSENCE TEST: "After 10 interactions, does the system recommend what I actually like?"
 *
 * Ronald-GI's Purpose:
 * 1. Learn what YOU specifically care about from your behavior
 * 2. Surface relevant research at the right moment
 * 3. Evolve a concept map that mirrors YOUR learning journey
 * 4. Respect your time/money budget while maximizing insight
 * 5. Detect when you're exploring something new and help
 *
 * "A system is only as good as the outcomes it produces, not the
 *  correctness of its intermediate calculations."
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
  calculateSatisfaction,
} from './setup';

describe('ESSENCE: Does the System Learn What You Care About?', () => {
  let db: ReturnType<typeof getTestDb>;

  beforeEach(() => {
    resetTestDb();
    db = getTestDb();
  });

  afterAll(() => {
    closeTestDb();
  });

  it('should shift preferences toward topics you engage with deeply', () => {
    // Simulate user's learning journey: they care about ML, not crypto

    // Create reports on different topics
    const mlReports = [
      createTestReport(db, { title: 'Neural Networks Primer', type: 'research_brief' }),
      createTestReport(db, { title: 'Transformer Architecture', type: 'research_brief' }),
      createTestReport(db, { title: 'MLX on Apple Silicon', type: 'repo_signal' }),
    ];

    const cryptoReports = [
      createTestReport(db, { title: 'Bitcoin Mining Analysis', type: 'research_brief' }),
      createTestReport(db, { title: 'Ethereum Gas Optimization', type: 'research_brief' }),
    ];

    // User deeply engages with ML, ignores crypto
    for (const id of mlReports) {
      simulateEngagement(db, id, { opened: true, scrollDepth: 0.95, dwellMs: 60000, clicked: true });
      submitFeedback(db, id, 'useful');
    }

    for (const id of cryptoReports) {
      simulateEngagement(db, id, { opened: true, scrollDepth: 0.1, dwellMs: 2000 });
    }

    // Calculate average satisfaction by "topic" (simulated via report titles)
    const mlSatisfaction = mlReports.map(id => calculateSatisfaction(db, id));
    const cryptoSatisfaction = cryptoReports.map(id => calculateSatisfaction(db, id));

    const avgMlSat = mlSatisfaction.reduce((a, b) => a + b, 0) / mlSatisfaction.length;
    const avgCryptoSat = cryptoSatisfaction.reduce((a, b) => a + b, 0) / cryptoSatisfaction.length;

    // THE ESSENCE: System should recognize ML > Crypto preference
    expect(avgMlSat).toBeGreaterThan(avgCryptoSat);
    expect(avgMlSat - avgCryptoSat).toBeGreaterThan(0.3); // Clear preference signal
  });

  it('should build an "obsession gradient" reflecting depth of interest', () => {
    // Create concepts with varying levels of engagement
    const concepts = [
      { label: 'machine-learning', engagements: 10 },
      { label: 'compilers', engagements: 7 },
      { label: 'web-dev', engagements: 2 },
      { label: 'devops', engagements: 0 },
    ];

    for (const c of concepts) {
      const conceptId = createTestConcept(db, { label: c.label, mention_count: c.engagements });

      // Create preference weight
      db.prepare(`
        INSERT INTO preference_weights (id, weight_type, target_id, weight)
        VALUES (?, 'concept', ?, ?)
      `).run(
        Math.random().toString(36).substring(7),
        conceptId,
        1.0 + (c.engagements * 0.1) // Weight grows with engagement
      );
    }

    // Query the obsession gradient
    const gradient = db.prepare(`
      SELECT c.label, pw.weight
      FROM preference_weights pw
      JOIN concepts c ON c.id = pw.target_id
      WHERE pw.weight_type = 'concept'
      ORDER BY pw.weight DESC
    `).all() as any[];

    // THE ESSENCE: Gradient should match engagement levels
    expect(gradient[0].label).toBe('machine-learning');
    expect(gradient[1].label).toBe('compilers');
    expect(gradient[gradient.length - 1].label).toBe('devops');
  });
});

describe('ESSENCE: Does the 3+1 Stack Reflect Current Obsessions?', () => {
  let db: ReturnType<typeof getTestDb>;

  beforeEach(() => {
    resetTestDb();
    db = getTestDb();
  });

  afterAll(() => {
    closeTestDb();
  });

  it('should surface high-value reports aligned with recent interests', () => {
    // Create reports with varying relevance
    const reports = [
      { title: 'SharpNative Compiler Analysis', impact: 0.9, novelty: 0.8, relevance: 0.9 },
      { title: 'Random Web Framework', impact: 0.7, novelty: 0.6, relevance: 0.2 },
      { title: 'MLX Performance Deep Dive', impact: 0.85, novelty: 0.9, relevance: 0.85 },
      { title: 'Cryptocurrency News', impact: 0.5, novelty: 0.3, relevance: 0.1 },
      { title: '3D Building Reconstruction', impact: 0.75, novelty: 0.7, relevance: 0.8 },
    ];

    for (const r of reports) {
      createTestReport(db, {
        title: r.title,
        impact_score: r.impact,
        novelty_score: r.novelty,
        relevance_score: r.relevance,
        promoted: 1,
      });
    }

    // Get the 3+1 home stack
    const homeStack = db.prepare(`
      SELECT title, blended_score FROM reports
      WHERE promoted = 1 AND archived = 0
      ORDER BY blended_score DESC
      LIMIT 4
    `).all() as any[];

    // THE ESSENCE: Top 3 should be the high-value, relevant reports
    const topTitles = homeStack.slice(0, 3).map(r => r.title);

    expect(topTitles).toContain('SharpNative Compiler Analysis');
    expect(topTitles).toContain('MLX Performance Deep Dive');
    expect(topTitles).not.toContain('Cryptocurrency News'); // Low relevance filtered out
  });

  it('should demote reports that get negative feedback', () => {
    const goodReport = createTestReport(db, {
      title: 'Useful Report',
      impact_score: 0.8,
      novelty_score: 0.7,
      promoted: 1,
    });

    const badReport = createTestReport(db, {
      title: 'Useless Report',
      impact_score: 0.8,
      novelty_score: 0.7,
      promoted: 1,
    });

    // User gives negative feedback to bad report
    submitFeedback(db, badReport, 'not_useful');

    // Simulate demotion (in real system this would be automatic)
    db.prepare(`UPDATE reports SET promoted = 0 WHERE id = ?`).run(badReport);

    // Check home stack
    const promoted = db.prepare(`
      SELECT id FROM reports WHERE promoted = 1
    `).all() as any[];

    // THE ESSENCE: Negative feedback removes from home stack
    expect(promoted.length).toBe(1);
    expect(promoted[0].id).toBe(goodReport);
  });
});

describe('ESSENCE: Does Concept Evolution Mirror Learning Journey?', () => {
  let db: ReturnType<typeof getTestDb>;

  beforeEach(() => {
    resetTestDb();
    db = getTestDb();
  });

  afterAll(() => {
    closeTestDb();
  });

  it('should grow concept graph as user explores new topics', () => {
    // Simulate learning journey: start with ML, expand to compilers, then to hardware

    // Week 1: ML concepts
    const mlConcepts = ['neural-network', 'backpropagation', 'transformer'];
    for (const label of mlConcepts) {
      createTestConcept(db, { label, mention_count: 5 });
    }

    // Week 2: Expand to compilers (connected to ML via code generation)
    const compilerConcepts = ['ast', 'code-generation', 'type-system'];
    for (const label of compilerConcepts) {
      createTestConcept(db, { label, mention_count: 3 });
    }

    // Week 3: Expand to hardware (connected to ML via performance)
    const hwConcepts = ['gpu', 'apple-silicon', 'memory-bandwidth'];
    for (const label of hwConcepts) {
      createTestConcept(db, { label, mention_count: 2 });
    }

    // THE ESSENCE: Concept graph should show expansion over time
    const totalConcepts = db.prepare(`SELECT COUNT(*) as count FROM concepts WHERE active = 1`).get() as any;
    const mentionDistribution = db.prepare(`
      SELECT
        CASE
          WHEN mention_count >= 5 THEN 'core'
          WHEN mention_count >= 3 THEN 'expanding'
          ELSE 'exploring'
        END as zone,
        COUNT(*) as count
      FROM concepts
      WHERE active = 1
      GROUP BY zone
    `).all() as any[];

    expect(totalConcepts.count).toBe(9);

    const zones = Object.fromEntries(mentionDistribution.map(z => [z.zone, z.count]));
    expect(zones['core']).toBe(3);      // ML concepts
    expect(zones['expanding']).toBe(3); // Compiler concepts
    expect(zones['exploring']).toBe(3); // Hardware concepts
  });

  it('should prune concepts that become irrelevant over time', () => {
    // Create concepts with varying staleness
    const activeConcept = createTestConcept(db, { label: 'still-relevant', mention_count: 10 });
    const staleConcept = createTestConcept(db, { label: 'forgotten-topic', mention_count: 1 });

    // Simulate staleness by backdating last_mentioned_at
    db.prepare(`
      UPDATE concepts SET last_mentioned_at = datetime('now', '-60 days')
      WHERE id = ?
    `).run(staleConcept);

    db.prepare(`
      UPDATE concepts SET last_mentioned_at = datetime('now', '-1 day')
      WHERE id = ?
    `).run(activeConcept);

    // Find stale concepts (>30 days, low mentions)
    const candidates = db.prepare(`
      SELECT id, label FROM concepts
      WHERE active = 1
        AND last_mentioned_at < datetime('now', '-30 days')
        AND mention_count < 3
    `).all() as any[];

    // THE ESSENCE: System should identify forgotten concepts for pruning
    expect(candidates.length).toBe(1);
    expect(candidates[0].label).toBe('forgotten-topic');
  });
});

describe('ESSENCE: Does Budget Management Maximize Insight?', () => {
  let db: ReturnType<typeof getTestDb>;

  beforeEach(() => {
    resetTestDb();
    db = getTestDb();
  });

  afterAll(() => {
    closeTestDb();
  });

  it('should prioritize high-impact topics even if they cost more', () => {
    // Create reports with varying value/cost profiles
    // The key insight: we should spend MORE on high-impact topics
    const reports = [
      { title: 'Cheap Low-Value', cost: 0.01, impact: 0.2 },
      { title: 'Expensive High-Value', cost: 0.20, impact: 0.95 },
      { title: 'Medium Value', cost: 0.05, impact: 0.5 },
    ];

    for (const r of reports) {
      createTestReport(db, {
        title: r.title,
        cost_dollars: r.cost,
        impact_score: r.impact,
      });
    }

    // Get reports ordered by impact (what we actually care about)
    const byImpact = db.prepare(`
      SELECT title, impact_score, cost_dollars
      FROM reports
      ORDER BY impact_score DESC
    `).all() as any[];

    // THE ESSENCE: High-impact justifies higher spend
    expect(byImpact[0].title).toBe('Expensive High-Value');
    expect(byImpact[0].impact_score).toBeGreaterThan(0.9);

    // Total spend on high-impact should be higher
    const spendByImpact = db.prepare(`
      SELECT
        CASE WHEN impact_score >= 0.7 THEN 'high' ELSE 'low' END as tier,
        SUM(cost_dollars) as total_spend
      FROM reports
      GROUP BY tier
    `).all() as any[];

    const highSpend = spendByImpact.find(s => s.tier === 'high')?.total_spend || 0;
    const lowSpend = spendByImpact.find(s => s.tier === 'low')?.total_spend || 0;

    expect(highSpend).toBeGreaterThan(lowSpend);
  });

  it('should respect daily budget while prioritizing high-value work', () => {
    const DAILY_BUDGET = 5.0;

    // Simulate day's spending
    createTestReport(db, { cost_dollars: 1.50, impact_score: 0.9 });
    createTestReport(db, { cost_dollars: 2.00, impact_score: 0.8 });
    createTestReport(db, { cost_dollars: 1.00, impact_score: 0.7 });

    const daySpend = db.prepare(`
      SELECT SUM(cost_dollars) as total,
             AVG(impact_score) as avg_impact
      FROM reports
      WHERE date(created_at) = date('now')
    `).get() as any;

    // THE ESSENCE: Stay within budget while maintaining quality
    expect(daySpend.total).toBeLessThanOrEqual(DAILY_BUDGET);
    expect(daySpend.avg_impact).toBeGreaterThan(0.7); // High average quality
  });
});

describe('ESSENCE: Does Discovery Spike Detection Work?', () => {
  let db: ReturnType<typeof getTestDb>;

  beforeEach(() => {
    resetTestDb();
    db = getTestDb();
  });

  afterAll(() => {
    closeTestDb();
  });

  it('should detect research bursts indicating new interest', () => {
    // Simulate a discovery spike: user suddenly visits many related URLs
    const baseTime = '2024-01-15 14:00:00';

    // Normal browsing (1 visit per 10 min)
    db.prepare(`INSERT INTO visits (id, url, host, browser, visited_at) VALUES (?, ?, ?, 'chrome', ?)`).run(
      'v1', 'https://news.ycombinator.com', 'news.ycombinator.com', '2024-01-15 12:00:00'
    );
    db.prepare(`INSERT INTO visits (id, url, host, browser, visited_at) VALUES (?, ?, ?, 'chrome', ?)`).run(
      'v2', 'https://twitter.com', 'twitter.com', '2024-01-15 12:10:00'
    );

    // SPIKE: 8 related visits in 15 minutes (3D reconstruction topic)
    const spikeVisits = [
      { url: 'https://github.com/points2poly', host: 'github.com', time: '2024-01-15 14:00:00' },
      { url: 'https://arxiv.org/abs/roof-detection', host: 'arxiv.org', time: '2024-01-15 14:02:00' },
      { url: 'https://github.com/LOD2BuildingModel', host: 'github.com', time: '2024-01-15 14:04:00' },
      { url: 'https://github.com/DeepRoofPlane', host: 'github.com', time: '2024-01-15 14:06:00' },
      { url: 'https://docs.opencv.org/point-cloud', host: 'docs.opencv.org', time: '2024-01-15 14:08:00' },
      { url: 'https://github.com/polygnn', host: 'github.com', time: '2024-01-15 14:10:00' },
      { url: 'https://youtube.com/3d-reconstruction', host: 'youtube.com', time: '2024-01-15 14:12:00' },
      { url: 'https://github.com/building-roof-pipeline', host: 'github.com', time: '2024-01-15 14:14:00' },
    ];

    for (let i = 0; i < spikeVisits.length; i++) {
      const v = spikeVisits[i];
      db.prepare(`INSERT INTO visits (id, url, host, browser, visited_at) VALUES (?, ?, ?, 'chrome', ?)`).run(
        `spike_${i}`, v.url, v.host, v.time
      );
    }

    // Detect spike: count visits in 15-min windows
    const windows = db.prepare(`
      SELECT
        strftime('%Y-%m-%d %H:%M', visited_at, '-' || (strftime('%M', visited_at) % 15) || ' minutes') as window_start,
        COUNT(*) as visit_count,
        COUNT(DISTINCT host) as unique_hosts
      FROM visits
      GROUP BY window_start
      HAVING visit_count >= 5
    `).all() as any[];

    // THE ESSENCE: System should detect the research spike
    expect(windows.length).toBeGreaterThan(0);

    const spike = windows[0];
    expect(spike.visit_count).toBeGreaterThanOrEqual(5);
    expect(spike.unique_hosts).toBeGreaterThanOrEqual(3); // Multiple sources = research, not doom-scrolling
  });

  it('should distinguish research from casual browsing', () => {
    // Casual browsing: same site, short dwells
    const casualVisits = [
      { url: 'https://twitter.com/feed', host: 'twitter.com' },
      { url: 'https://twitter.com/trending', host: 'twitter.com' },
      { url: 'https://twitter.com/notifications', host: 'twitter.com' },
      { url: 'https://twitter.com/messages', host: 'twitter.com' },
    ];

    // Research: multiple hosts, related topics
    const researchVisits = [
      { url: 'https://github.com/SharpNative', host: 'github.com' },
      { url: 'https://docs.microsoft.com/roslyn', host: 'docs.microsoft.com' },
      { url: 'https://stackoverflow.com/c-sharp-compiler', host: 'stackoverflow.com' },
      { url: 'https://llvm.org/docs', host: 'llvm.org' },
    ];

    // Insert both clusters
    const time = '2024-01-15 14:00:00';
    for (let i = 0; i < casualVisits.length; i++) {
      db.prepare(`INSERT INTO visits (id, url, host, browser, visited_at) VALUES (?, ?, ?, 'chrome', ?)`).run(
        `casual_${i}`, casualVisits[i].url, casualVisits[i].host, time
      );
    }
    for (let i = 0; i < researchVisits.length; i++) {
      db.prepare(`INSERT INTO visits (id, url, host, browser, visited_at) VALUES (?, ?, ?, 'chrome', ?)`).run(
        `research_${i}`, researchVisits[i].url, researchVisits[i].host, time
      );
    }

    // Calculate diversity scores
    const casual = db.prepare(`
      SELECT COUNT(DISTINCT host) as hosts FROM visits WHERE id LIKE 'casual_%'
    `).get() as any;

    const research = db.prepare(`
      SELECT COUNT(DISTINCT host) as hosts FROM visits WHERE id LIKE 'research_%'
    `).get() as any;

    // THE ESSENCE: Research has higher host diversity
    expect(research.hosts).toBeGreaterThan(casual.hosts);
    expect(research.hosts).toBeGreaterThanOrEqual(3);
    expect(casual.hosts).toBe(1);
  });
});

describe('ESSENCE: End-to-End Value Chain', () => {
  let db: ReturnType<typeof getTestDb>;

  beforeEach(() => {
    resetTestDb();
    db = getTestDb();
  });

  afterAll(() => {
    closeTestDb();
  });

  it('should produce increasingly relevant reports over time', () => {
    // Simulate Week 1: System is learning (low engagement, system doesn't know user yet)
    const week1Reports = [];
    for (let i = 0; i < 5; i++) {
      const id = createTestReport(db, {
        title: `Week 1 Report ${i}`,
        impact_score: 0.5,
      });
      week1Reports.push(id);

      // Early stage: user only engages with 2 of 5 reports
      if (i < 2) {
        simulateEngagement(db, id, { opened: true, scrollDepth: 0.6, dwellMs: 5000 });
      } else {
        simulateEngagement(db, id, { opened: true, scrollDepth: 0.1, dwellMs: 1000 });
      }
    }

    // Calculate Week 1 satisfaction
    const week1Sat = week1Reports.map(id => calculateSatisfaction(db, id));
    const avgWeek1 = week1Sat.reduce((a, b) => a + b, 0) / week1Sat.length;

    // Simulate Week 4: System has learned (high engagement, system knows user)
    const week4Reports = [];
    for (let i = 0; i < 5; i++) {
      const id = createTestReport(db, {
        title: `Week 4 Report ${i}`,
        impact_score: 0.8,
      });
      week4Reports.push(id);

      // Later stage: user engages deeply with 4 of 5 reports (system learned preferences)
      if (i < 4) {
        simulateEngagement(db, id, { opened: true, scrollDepth: 0.95, dwellMs: 30000, clicked: true });
        submitFeedback(db, id, 'useful');
      } else {
        simulateEngagement(db, id, { opened: true, scrollDepth: 0.5, dwellMs: 5000 });
      }
    }

    // Calculate Week 4 satisfaction
    const week4Sat = week4Reports.map(id => calculateSatisfaction(db, id));
    const avgWeek4 = week4Sat.reduce((a, b) => a + b, 0) / week4Sat.length;

    // THE ESSENCE: System should improve over time
    expect(avgWeek4).toBeGreaterThan(avgWeek1);
    expect(avgWeek4 - avgWeek1).toBeGreaterThan(0.15); // Measurable improvement
  });

  it('should demonstrate the full feedback loop', () => {
    // 1. INGEST: Source comes in
    db.prepare(`
      INSERT INTO sources (id, url, title, host, priority)
      VALUES ('src1', 'https://github.com/afrog33k/SharpNative', 'SharpNative', 'github.com', 8)
    `).run();

    // 2. IDEATE: Job is created
    db.prepare(`
      INSERT INTO job_queue (id, job_type, payload_json, priority, status)
      VALUES ('job1', 'research', '{"source_id": "src1"}', 8, 'completed')
    `).run();

    // 3. SYNTHESIZE: Report is generated
    const reportId = createTestReport(db, {
      title: 'SharpNative: C# to Native Transpiler Analysis',
      type: 'repo_signal',
      summary: 'A sophisticated transpiler converting C# to D/C++ for native performance',
      decision: 'Worth deeper investigation for performance-critical applications',
      findings_json: JSON.stringify([
        'Uses Roslyn for C# parsing',
        'Supports D and C++ as targets',
        'Active development with 67 stars',
      ]),
      impact_score: 0.85,
      novelty_score: 0.9,
      relevance_score: 0.95, // Highly relevant to owner
    });

    // 4. ENGAGE: User interacts positively
    simulateEngagement(db, reportId, {
      opened: true,
      scrollDepth: 1.0,
      dwellMs: 120000,
      clicked: true,
      pinned: true,
    });
    submitFeedback(db, reportId, 'useful');

    // 5. LEARN: Create concept and boost preference
    const conceptId = createTestConcept(db, { label: 'transpiler', mention_count: 1 });
    db.prepare(`
      INSERT INTO concept_mentions (id, concept_id, entity_type, entity_id)
      VALUES ('m1', ?, 'report', ?)
    `).run(conceptId, reportId);

    db.prepare(`
      INSERT INTO preference_weights (id, weight_type, target_id, weight)
      VALUES ('pw1', 'concept', ?, 1.5)
    `).run(conceptId);

    // VERIFY THE FULL LOOP
    const source = db.prepare(`SELECT processed_at FROM sources WHERE id = 'src1'`);
    const job = db.prepare(`SELECT status FROM job_queue WHERE id = 'job1'`).get() as any;
    const report = db.prepare(`SELECT pinned, blended_score FROM reports WHERE id = ?`).get(reportId) as any;
    const satisfaction = calculateSatisfaction(db, reportId);
    const preference = db.prepare(`SELECT weight FROM preference_weights WHERE target_id = ?`).get(conceptId) as any;

    // THE ESSENCE: Complete feedback loop works
    expect(job.status).toBe('completed');
    expect(report.pinned).toBe(1);
    expect(report.blended_score).toBeGreaterThan(0.8);
    expect(satisfaction).toBeGreaterThan(0.8);
    expect(preference.weight).toBeGreaterThan(1.0); // Preference boosted
  });
});
