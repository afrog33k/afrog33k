-- Ronald-GI POC v1 - Concept Drift Schema
-- Tracks concept changes for diff view and undo operations

-- Concept change log for weekly diff view
CREATE TABLE IF NOT EXISTS concept_changes (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    concept_id TEXT NOT NULL,
    change_type TEXT NOT NULL, -- 'created' | 'merged' | 'unmerged' | 'killed' | 'revived' | 'updated'
    old_state_json TEXT, -- snapshot before change
    new_state_json TEXT, -- snapshot after change
    related_concept_id TEXT, -- for merges, the target concept
    reason TEXT, -- why the change was made
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_concept_changes_concept ON concept_changes(concept_id);
CREATE INDEX IF NOT EXISTS idx_concept_changes_type ON concept_changes(change_type);
CREATE INDEX IF NOT EXISTS idx_concept_changes_created ON concept_changes(created_at DESC);

-- Merge suggestions (precomputed)
CREATE TABLE IF NOT EXISTS merge_suggestions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    concept_a_id TEXT NOT NULL REFERENCES concepts(id),
    concept_b_id TEXT NOT NULL REFERENCES concepts(id),
    similarity REAL NOT NULL,
    status TEXT DEFAULT 'pending', -- 'pending' | 'accepted' | 'rejected' | 'expired'
    reason TEXT, -- why this merge is suggested
    created_at TEXT DEFAULT (datetime('now')),
    reviewed_at TEXT,
    UNIQUE(concept_a_id, concept_b_id)
);

CREATE INDEX IF NOT EXISTS idx_merge_suggestions_status ON merge_suggestions(status);
CREATE INDEX IF NOT EXISTS idx_merge_suggestions_similarity ON merge_suggestions(similarity DESC);

-- Kill suggestions (precomputed)
CREATE TABLE IF NOT EXISTS kill_suggestions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    concept_id TEXT NOT NULL REFERENCES concepts(id),
    reason TEXT NOT NULL, -- 'low_engagement' | 'orphan' | 'duplicate' | 'stale'
    confidence REAL DEFAULT 0.5,
    status TEXT DEFAULT 'pending', -- 'pending' | 'accepted' | 'rejected'
    created_at TEXT DEFAULT (datetime('now')),
    reviewed_at TEXT,
    UNIQUE(concept_id, reason)
);

CREATE INDEX IF NOT EXISTS idx_kill_suggestions_status ON kill_suggestions(status);
CREATE INDEX IF NOT EXISTS idx_kill_suggestions_confidence ON kill_suggestions(confidence DESC);

-- Add killed_at column to concepts for soft delete tracking
-- Note: SQLite doesn't support ADD COLUMN IF NOT EXISTS, so we check via pragma
-- This is handled in application code during migration
