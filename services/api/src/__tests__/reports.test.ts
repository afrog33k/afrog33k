import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getTestDb, resetTestDb, closeTestDb } from './setup';

describe('Reports', () => {
  let db: ReturnType<typeof getTestDb>;

  beforeEach(() => {
    resetTestDb();
    db = getTestDb();
  });

  afterAll(() => {
    closeTestDb();
  });

  describe('CRUD operations', () => {
    it('should create a report', () => {
      const id = 'test-report-1';
      db.prepare(`
        INSERT INTO reports (id, type, title, summary, impact_score, novelty_score, relevance_score, promoted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, 'decision_memo', 'Test Decision', 'Test summary', 0.8, 0.7, 0.6, 1);

      const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(id) as any;

      expect(report).toBeDefined();
      expect(report.title).toBe('Test Decision');
      expect(report.type).toBe('decision_memo');
      expect(report.impact_score).toBe(0.8);
    });

    it('should calculate blended_score correctly', () => {
      const id = 'test-report-2';
      db.prepare(`
        INSERT INTO reports (id, type, title, impact_score, novelty_score, relevance_score)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, 'research_brief', 'Test Research', 1.0, 0.5, 0.2);

      const report = db.prepare('SELECT blended_score FROM reports WHERE id = ?').get(id) as any;

      // blended = 0.45 * impact + 0.45 * novelty + 0.10 * relevance
      // = 0.45 * 1.0 + 0.45 * 0.5 + 0.10 * 0.2 = 0.45 + 0.225 + 0.02 = 0.695
      expect(report.blended_score).toBeCloseTo(0.695, 2);
    });

    it('should update pinned status', () => {
      const id = 'test-report-3';
      db.prepare(`
        INSERT INTO reports (id, type, title, pinned)
        VALUES (?, ?, ?, ?)
      `).run(id, 'repo_signal', 'Test Repo', 0);

      db.prepare('UPDATE reports SET pinned = 1 WHERE id = ?').run(id);

      const report = db.prepare('SELECT pinned FROM reports WHERE id = ?').get(id) as any;
      expect(report.pinned).toBe(1);
    });

    it('should filter by type', () => {
      db.prepare(`INSERT INTO reports (id, type, title) VALUES (?, ?, ?)`).run('r1', 'decision_memo', 'D1');
      db.prepare(`INSERT INTO reports (id, type, title) VALUES (?, ?, ?)`).run('r2', 'research_brief', 'R1');
      db.prepare(`INSERT INTO reports (id, type, title) VALUES (?, ?, ?)`).run('r3', 'decision_memo', 'D2');

      const decisions = db.prepare(`SELECT * FROM reports WHERE type = ? AND archived = 0`).all('decision_memo');
      expect(decisions).toHaveLength(2);
    });

    it('should exclude archived reports', () => {
      db.prepare(`INSERT INTO reports (id, type, title, archived) VALUES (?, ?, ?, ?)`).run('r1', 'decision_memo', 'Active', 0);
      db.prepare(`INSERT INTO reports (id, type, title, archived) VALUES (?, ?, ?, ?)`).run('r2', 'decision_memo', 'Archived', 1);

      const reports = db.prepare(`SELECT * FROM reports WHERE archived = 0`).all();
      expect(reports).toHaveLength(1);
    });
  });

  describe('3+1 Home Stack', () => {
    it('should return top 3 by blended score', () => {
      // Create 5 promoted reports with different scores
      // blended = 0.45 * impact + 0.45 * novelty + 0.10 * relevance
      db.prepare(`INSERT INTO reports (id, type, title, impact_score, novelty_score, promoted) VALUES (?, ?, ?, ?, ?, 1)`).run('r1', 'decision_memo', 'Low', 0.2, 0.2);          // 0.18
      db.prepare(`INSERT INTO reports (id, type, title, impact_score, novelty_score, promoted) VALUES (?, ?, ?, ?, ?, 1)`).run('r2', 'decision_memo', 'High', 0.9, 0.85);        // 0.7875
      db.prepare(`INSERT INTO reports (id, type, title, impact_score, novelty_score, promoted) VALUES (?, ?, ?, ?, ?, 1)`).run('r3', 'decision_memo', 'Medium', 0.5, 0.5);       // 0.45
      db.prepare(`INSERT INTO reports (id, type, title, impact_score, novelty_score, promoted) VALUES (?, ?, ?, ?, ?, 1)`).run('r4', 'decision_memo', 'Very High', 1.0, 1.0);    // 0.90
      db.prepare(`INSERT INTO reports (id, type, title, impact_score, novelty_score, promoted) VALUES (?, ?, ?, ?, ?, 1)`).run('r5', 'decision_memo', 'Mid High', 0.7, 0.6);     // 0.585

      const top3 = db.prepare(`
        SELECT id, title, blended_score FROM reports
        WHERE archived = 0 AND promoted = 1
        ORDER BY blended_score DESC
        LIMIT 3
      `).all() as any[];

      expect(top3).toHaveLength(3);
      expect(top3[0].title).toBe('Very High');   // 0.90
      expect(top3[1].title).toBe('High');        // 0.7875
    });

    it('should exclude non-promoted from home stack', () => {
      db.prepare(`INSERT INTO reports (id, type, title, promoted) VALUES (?, ?, ?, ?)`).run('r1', 'decision_memo', 'Promoted', 1);
      db.prepare(`INSERT INTO reports (id, type, title, promoted) VALUES (?, ?, ?, ?)`).run('r2', 'decision_memo', 'Not Promoted', 0);

      const home = db.prepare(`SELECT * FROM reports WHERE promoted = 1 AND archived = 0`).all();
      expect(home).toHaveLength(1);
    });
  });
});

describe('Sources', () => {
  let db: ReturnType<typeof getTestDb>;

  beforeEach(() => {
    resetTestDb();
    db = getTestDb();
  });

  afterAll(() => {
    closeTestDb();
  });

  it('should create a source', () => {
    db.prepare(`
      INSERT INTO sources (id, url, title, host, priority)
      VALUES (?, ?, ?, ?, ?)
    `).run('s1', 'https://example.com/page', 'Example', 'example.com', 5);

    const source = db.prepare('SELECT * FROM sources WHERE id = ?').get('s1') as any;
    expect(source.url).toBe('https://example.com/page');
    expect(source.host).toBe('example.com');
    expect(source.priority).toBe(5);
  });

  it('should enforce unique URL', () => {
    db.prepare(`INSERT INTO sources (id, url, host) VALUES (?, ?, ?)`).run('s1', 'https://example.com', 'example.com');

    expect(() => {
      db.prepare(`INSERT INTO sources (id, url, host) VALUES (?, ?, ?)`).run('s2', 'https://example.com', 'example.com');
    }).toThrow();
  });

  it('should track processed status', () => {
    db.prepare(`INSERT INTO sources (id, url, host) VALUES (?, ?, ?)`).run('s1', 'https://example.com', 'example.com');

    const unprocessed = db.prepare(`SELECT * FROM sources WHERE processed_at IS NULL`).all();
    expect(unprocessed).toHaveLength(1);

    db.prepare(`UPDATE sources SET processed_at = datetime('now') WHERE id = ?`).run('s1');

    const processed = db.prepare(`SELECT * FROM sources WHERE processed_at IS NOT NULL`).all();
    expect(processed).toHaveLength(1);
  });
});

describe('Concepts', () => {
  let db: ReturnType<typeof getTestDb>;

  beforeEach(() => {
    resetTestDb();
    db = getTestDb();
  });

  afterAll(() => {
    closeTestDb();
  });

  it('should create a concept', () => {
    db.prepare(`INSERT INTO concepts (id, label, description) VALUES (?, ?, ?)`).run('c1', 'machine-learning', 'ML techniques');

    const concept = db.prepare('SELECT * FROM concepts WHERE id = ?').get('c1') as any;
    expect(concept.label).toBe('machine-learning');
    expect(concept.active).toBe(1);
  });

  it('should track mention count', () => {
    db.prepare(`INSERT INTO concepts (id, label) VALUES (?, ?)`).run('c1', 'test-concept');
    db.prepare(`INSERT INTO reports (id, type, title) VALUES (?, ?, ?)`).run('r1', 'research_brief', 'Report 1');

    db.prepare(`INSERT INTO concept_mentions (id, concept_id, entity_type, entity_id) VALUES (?, ?, ?, ?)`).run('m1', 'c1', 'report', 'r1');
    db.prepare(`UPDATE concepts SET mention_count = mention_count + 1 WHERE id = ?`).run('c1');

    const concept = db.prepare('SELECT mention_count FROM concepts WHERE id = ?').get('c1') as any;
    expect(concept.mention_count).toBe(1);
  });

  it('should support reversible merges', () => {
    db.prepare(`INSERT INTO concepts (id, label) VALUES (?, ?)`).run('c1', 'ml');
    db.prepare(`INSERT INTO concepts (id, label) VALUES (?, ?)`).run('c2', 'machine-learning');

    // Merge c1 into c2
    db.prepare(`UPDATE concepts SET merged_into_id = ?, active = 0 WHERE id = ?`).run('c2', 'c1');

    const merged = db.prepare('SELECT * FROM concepts WHERE id = ?').get('c1') as any;
    expect(merged.active).toBe(0);
    expect(merged.merged_into_id).toBe('c2');

    // Unmerge
    db.prepare(`UPDATE concepts SET merged_into_id = NULL, active = 1 WHERE id = ?`).run('c1');

    const unmerged = db.prepare('SELECT * FROM concepts WHERE id = ?').get('c1') as any;
    expect(unmerged.active).toBe(1);
    expect(unmerged.merged_into_id).toBeNull();
  });
});

describe('Telemetry', () => {
  let db: ReturnType<typeof getTestDb>;

  beforeEach(() => {
    resetTestDb();
    db = getTestDb();
  });

  afterAll(() => {
    closeTestDb();
  });

  it('should record telemetry events', () => {
    db.prepare(`INSERT INTO reports (id, type, title) VALUES (?, ?, ?)`).run('r1', 'decision_memo', 'Test');

    db.prepare(`INSERT INTO telemetry (id, report_id, event_type, event_data_json) VALUES (?, ?, ?, ?)`).run('t1', 'r1', 'open', '{}');
    db.prepare(`INSERT INTO telemetry (id, report_id, event_type, event_data_json) VALUES (?, ?, ?, ?)`).run('t2', 'r1', 'scroll', '{"depth": 0.5}');
    db.prepare(`INSERT INTO telemetry (id, report_id, event_type, event_data_json) VALUES (?, ?, ?, ?)`).run('t3', 'r1', 'close', '{"dwell_ms": 5000}');

    const events = db.prepare(`SELECT * FROM telemetry WHERE report_id = ?`).all('r1');
    expect(events).toHaveLength(3);
  });

  it('should track UI action stats', () => {
    const action = db.prepare('SELECT * FROM ui_action_stats WHERE action = ?').get('useful') as any;
    expect(action).toBeDefined();
    expect(action.enabled).toBe(1);

    // Simulate showing and clicking
    db.prepare(`UPDATE ui_action_stats SET shown_count = shown_count + 1 WHERE action = ?`).run('useful');
    db.prepare(`UPDATE ui_action_stats SET clicked_count = clicked_count + 1 WHERE action = ?`).run('useful');

    const updated = db.prepare('SELECT success_rate FROM ui_action_stats WHERE action = ?').get('useful') as any;
    expect(updated.success_rate).toBe(1.0); // 1 click / 1 shown
  });
});

describe('Job Queue', () => {
  let db: ReturnType<typeof getTestDb>;

  beforeEach(() => {
    resetTestDb();
    db = getTestDb();
  });

  afterAll(() => {
    closeTestDb();
  });

  it('should create and claim jobs', () => {
    db.prepare(`INSERT INTO job_queue (id, job_type, payload_json, priority) VALUES (?, ?, ?, ?)`).run('j1', 'ideation', '{}', 0);
    db.prepare(`INSERT INTO job_queue (id, job_type, payload_json, priority) VALUES (?, ?, ?, ?)`).run('j2', 'research', '{}', 10);

    // Claim highest priority pending job
    const job = db.prepare(`
      SELECT * FROM job_queue
      WHERE status = 'pending'
      ORDER BY priority DESC, created_at ASC
      LIMIT 1
    `).get() as any;

    expect(job.id).toBe('j2'); // Higher priority
    expect(job.job_type).toBe('research');

    // Mark as running
    db.prepare(`UPDATE job_queue SET status = 'running', started_at = datetime('now') WHERE id = ?`).run('j2');

    const running = db.prepare(`SELECT status FROM job_queue WHERE id = ?`).get('j2') as any;
    expect(running.status).toBe('running');
  });

  it('should handle job retries', () => {
    db.prepare(`INSERT INTO job_queue (id, job_type, max_attempts) VALUES (?, ?, ?)`).run('j1', 'research', 3);

    // First attempt
    db.prepare(`UPDATE job_queue SET status = 'running', attempts = 1 WHERE id = ?`).run('j1');

    // Fail and retry
    db.prepare(`UPDATE job_queue SET status = 'pending', error_message = 'Network error' WHERE id = ?`).run('j1');

    const job = db.prepare('SELECT * FROM job_queue WHERE id = ?').get('j1') as any;
    expect(job.status).toBe('pending');
    expect(job.attempts).toBe(1);
    expect(job.error_message).toBe('Network error');
  });
});
