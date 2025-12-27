-- Ronald-GI POC v1 Initial Schema
-- SQLite as system-of-record

-- ============================================
-- SOURCES / INPUTS
-- ============================================

-- Bookmarks and explicit links (seeds)
CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    url TEXT NOT NULL UNIQUE,
    title TEXT,
    description TEXT,
    host TEXT NOT NULL,
    tags_json TEXT DEFAULT '[]',
    priority INTEGER DEFAULT 0,
    processed_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sources_host ON sources(host);
CREATE INDEX IF NOT EXISTS idx_sources_processed ON sources(processed_at);

-- Safari/Chrome history visits
CREATE TABLE IF NOT EXISTS visits (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    url TEXT NOT NULL,
    title TEXT,
    host TEXT NOT NULL,
    browser TEXT NOT NULL, -- 'safari' | 'chrome'
    visited_at TEXT NOT NULL,
    duration_seconds INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_visits_host ON visits(host);
CREATE INDEX IF NOT EXISTS idx_visits_visited_at ON visits(visited_at);
CREATE INDEX IF NOT EXISTS idx_visits_browser ON visits(browser);

-- Time + semantic clusters of visits ("discovery spikes")
CREATE TABLE IF NOT EXISTS visit_clusters (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    urls_json TEXT NOT NULL DEFAULT '[]', -- top 60 links
    stats_json TEXT NOT NULL DEFAULT '{}', -- {hosts: {}, count: N, semantic: bool}
    embedding BLOB, -- float32 array
    burst_score REAL DEFAULT 0, -- density vs baseline
    novelty_score REAL DEFAULT 0, -- how new vs history
    intensity REAL GENERATED ALWAYS AS (0.6 * burst_score + 0.4 * novelty_score) STORED,
    processed_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_clusters_intensity ON visit_clusters(intensity DESC);
CREATE INDEX IF NOT EXISTS idx_clusters_started ON visit_clusters(started_at);

-- Extracted documents (repo READMEs, article text)
CREATE TABLE IF NOT EXISTS docs (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    source_url TEXT NOT NULL,
    source_type TEXT NOT NULL, -- 'repo_readme' | 'article' | 'paper'
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL, -- for deduplication
    embedding BLOB,
    metadata_json TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_docs_hash ON docs(content_hash);
CREATE INDEX IF NOT EXISTS idx_docs_source ON docs(source_url);

-- ============================================
-- OUTPUTS
-- ============================================

-- Generated reports (the core output)
CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    type TEXT NOT NULL, -- 'decision_memo' | 'research_brief' | 'repo_signal' | 'concept_drift' | 'watchlist_alert'
    title TEXT NOT NULL,
    summary TEXT,
    findings_json TEXT DEFAULT '[]',
    decision TEXT,
    next_actions_json TEXT DEFAULT '[]',
    evidence_json TEXT DEFAULT '[]', -- [{url, title, excerpt}]
    ui_blocks_json TEXT DEFAULT '[]', -- A2UI-style blocks
    concept_ids_json TEXT DEFAULT '[]', -- linked concepts

    -- Scores
    impact_score REAL DEFAULT 0,
    novelty_score REAL DEFAULT 0,
    relevance_score REAL DEFAULT 0,
    blended_score REAL GENERATED ALWAYS AS (0.45 * impact_score + 0.45 * novelty_score + 0.10 * relevance_score) STORED,

    -- State
    pinned INTEGER DEFAULT 0,
    promoted INTEGER DEFAULT 0,
    archived INTEGER DEFAULT 0,

    -- Provenance
    source_cluster_id TEXT REFERENCES visit_clusters(id),
    source_id TEXT REFERENCES sources(id),
    cost_tokens INTEGER DEFAULT 0,
    cost_dollars REAL DEFAULT 0,

    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reports_type ON reports(type);
CREATE INDEX IF NOT EXISTS idx_reports_blended ON reports(blended_score DESC);
CREATE INDEX IF NOT EXISTS idx_reports_promoted ON reports(promoted);
CREATE INDEX IF NOT EXISTS idx_reports_pinned ON reports(pinned);
CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at DESC);

-- Telemetry (implicit engagement signals)
CREATE TABLE IF NOT EXISTS telemetry (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    report_id TEXT NOT NULL REFERENCES reports(id),
    event_type TEXT NOT NULL, -- 'open' | 'close' | 'dwell' | 'scroll' | 'click' | 'pin'
    event_data_json TEXT DEFAULT '{}', -- {scroll_depth, dwell_ms, link_clicked, etc}
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_telemetry_report ON telemetry(report_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_type ON telemetry(event_type);
CREATE INDEX IF NOT EXISTS idx_telemetry_created ON telemetry(created_at);

-- Explicit feedback (button presses)
CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    report_id TEXT NOT NULL REFERENCES reports(id),
    action TEXT NOT NULL, -- dynamic set of actions
    comment TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_feedback_report ON feedback(report_id);
CREATE INDEX IF NOT EXISTS idx_feedback_action ON feedback(action);

-- ============================================
-- LEARNING / CONTROL PLANES
-- ============================================

-- Bandit stats for UI actions (prune buttons)
CREATE TABLE IF NOT EXISTS ui_action_stats (
    action TEXT PRIMARY KEY,
    enabled INTEGER DEFAULT 1,
    shown_count INTEGER DEFAULT 0,
    clicked_count INTEGER DEFAULT 0,
    success_rate REAL GENERATED ALWAYS AS (
        CASE WHEN shown_count > 0 THEN CAST(clicked_count AS REAL) / shown_count ELSE 0 END
    ) STORED,
    last_shown_at TEXT,
    last_clicked_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Preference weights (concept/host/type weights)
CREATE TABLE IF NOT EXISTS preference_weights (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    weight_type TEXT NOT NULL, -- 'concept' | 'host' | 'report_type'
    target_id TEXT NOT NULL, -- concept_id, host, or report_type
    weight REAL DEFAULT 1.0,
    decay_rate REAL DEFAULT 0.95, -- for temporal decay
    last_engagement_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(weight_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_weights_type ON preference_weights(weight_type);

-- Concepts (your evolving concept map)
CREATE TABLE IF NOT EXISTS concepts (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    label TEXT NOT NULL UNIQUE,
    description TEXT,
    embedding BLOB,
    parent_id TEXT REFERENCES concepts(id),
    merged_into_id TEXT REFERENCES concepts(id), -- for reversible merges
    active INTEGER DEFAULT 1,
    mention_count INTEGER DEFAULT 0,
    last_mentioned_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_concepts_label ON concepts(label);
CREATE INDEX IF NOT EXISTS idx_concepts_active ON concepts(active);
CREATE INDEX IF NOT EXISTS idx_concepts_mentions ON concepts(mention_count DESC);

-- Concept mentions (linking concepts to reports/docs)
CREATE TABLE IF NOT EXISTS concept_mentions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    concept_id TEXT NOT NULL REFERENCES concepts(id),
    entity_type TEXT NOT NULL, -- 'report' | 'doc' | 'visit_cluster'
    entity_id TEXT NOT NULL,
    confidence REAL DEFAULT 1.0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mentions_concept ON concept_mentions(concept_id);
CREATE INDEX IF NOT EXISTS idx_mentions_entity ON concept_mentions(entity_type, entity_id);

-- ============================================
-- CACHES (precomputed nearest neighbors)
-- ============================================

CREATE TABLE IF NOT EXISTS nearest_concepts (
    concept_id TEXT NOT NULL REFERENCES concepts(id),
    neighbor_id TEXT NOT NULL REFERENCES concepts(id),
    distance REAL NOT NULL,
    rank INTEGER NOT NULL,
    computed_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (concept_id, neighbor_id)
);

CREATE TABLE IF NOT EXISTS nearest_reports (
    report_id TEXT NOT NULL REFERENCES reports(id),
    neighbor_id TEXT NOT NULL REFERENCES reports(id),
    distance REAL NOT NULL,
    rank INTEGER NOT NULL,
    computed_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (report_id, neighbor_id)
);

CREATE TABLE IF NOT EXISTS nearest_visits (
    cluster_id TEXT NOT NULL REFERENCES visit_clusters(id),
    neighbor_id TEXT NOT NULL REFERENCES visit_clusters(id),
    distance REAL NOT NULL,
    rank INTEGER NOT NULL,
    computed_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (cluster_id, neighbor_id)
);

-- ============================================
-- SYSTEM STATE
-- ============================================

-- Job queue for worker
CREATE TABLE IF NOT EXISTS job_queue (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    job_type TEXT NOT NULL, -- 'ideation' | 'research' | 'synthesis' | 'meta'
    payload_json TEXT NOT NULL DEFAULT '{}',
    status TEXT DEFAULT 'pending', -- 'pending' | 'running' | 'completed' | 'failed'
    priority INTEGER DEFAULT 0,
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    error_message TEXT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON job_queue(status, priority DESC);

-- System config / state
CREATE TABLE IF NOT EXISTS system_state (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Insert default UI actions
INSERT OR IGNORE INTO ui_action_stats (action, enabled) VALUES
    ('useful', 1),
    ('not_useful', 1),
    ('more_depth', 1),
    ('kill_thread', 1),
    ('revisit_later', 1);

-- Insert default system state
INSERT OR IGNORE INTO system_state (key, value_json) VALUES
    ('ideation_weights', '{"impact": 0.45, "novelty": 0.45, "relevance": 0.10}'),
    ('budget_daily_dollars', '5.0'),
    ('budget_spent_today', '0.0'),
    ('last_ingestion', '{}'),
    ('ollama_model', '"qwen2.5:7b"');
