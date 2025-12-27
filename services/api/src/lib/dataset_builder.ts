/**
 * Dataset Builder for Ronald-GI Local Fine-tuning
 *
 * Phase 8 implementation: Collects user behavior data for preference model training
 *
 * Data sources:
 * 1. Pinned reports - What the user explicitly values
 * 2. Edit history - What the user corrects/improves
 * 3. Accept/reject decisions - Binary preference signals
 * 4. Engagement telemetry - Implicit satisfaction signals
 *
 * Output format: JSONL compatible with common fine-tuning frameworks
 */

import Database from 'better-sqlite3';

// ============================================
// DATA COLLECTION TYPES
// ============================================

export interface PreferenceDataPoint {
  id: string;
  type: 'pinned' | 'edited' | 'accepted' | 'rejected' | 'engagement';
  timestamp: string;
  input: string;           // The context/prompt that led to this output
  output: string;          // The report/response content
  chosen: boolean;         // Whether this was preferred
  score: number;           // Preference strength 0-1
  metadata: {
    reportId?: string;
    reportType?: string;
    concepts?: string[];
    dwellMs?: number;
    scrollDepth?: number;
  };
}

export interface TrainingExample {
  prompt: string;
  chosen: string;
  rejected?: string;
  weight: number;
}

export interface DatasetStats {
  totalExamples: number;
  pinnedCount: number;
  editedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  engagementCount: number;
  conceptCoverage: number;
  dateRange: { start: string; end: string };
}

// ============================================
// DATASET BUILDER
// ============================================

export class DatasetBuilder {
  constructor(private db: Database.Database) {}

  /**
   * Collect all preference data from the database
   */
  collectPreferenceData(): PreferenceDataPoint[] {
    const data: PreferenceDataPoint[] = [];

    data.push(...this.collectPinnedReports());
    data.push(...this.collectEditHistory());
    data.push(...this.collectFeedbackDecisions());
    data.push(...this.collectEngagementSignals());

    // Sort by timestamp
    data.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    return data;
  }

  /**
   * Pinned reports = strongest positive signal
   */
  private collectPinnedReports(): PreferenceDataPoint[] {
    const reports = this.db.prepare(`
      SELECT
        r.id,
        r.type,
        r.title,
        r.summary,
        r.decision,
        r.findings_json,
        r.evidence_json,
        r.concept_ids_json,
        r.created_at,
        s.title as source_title,
        s.url as source_url
      FROM reports r
      LEFT JOIN sources s ON r.source_id = s.id
      WHERE r.pinned = 1
      ORDER BY r.created_at DESC
    `).all() as any[];

    return reports.map(r => {
      const concepts = this.getReportConcepts(r.id);
      return {
        id: `pinned_${r.id}`,
        type: 'pinned' as const,
        timestamp: r.created_at,
        input: this.buildInputContext(r.source_title, r.source_url, r.type),
        output: this.buildReportOutput(r),
        chosen: true,
        score: 1.0,  // Pinned = maximum preference
        metadata: {
          reportId: r.id,
          reportType: r.type,
          concepts,
        },
      };
    });
  }

  /**
   * Edited reports = user corrections (valuable for learning mistakes)
   */
  private collectEditHistory(): PreferenceDataPoint[] {
    // Check if edit_history table exists
    try {
      const edits = this.db.prepare(`
        SELECT
          eh.id,
          eh.report_id,
          eh.field_name,
          eh.old_value,
          eh.new_value,
          eh.created_at,
          r.type,
          r.title
        FROM edit_history eh
        JOIN reports r ON eh.report_id = r.id
        ORDER BY eh.created_at DESC
      `).all() as any[];

      return edits.map(e => ({
        id: `edit_${e.id}`,
        type: 'edited' as const,
        timestamp: e.created_at,
        input: `Field: ${e.field_name}\nOriginal: ${e.old_value || '(empty)'}`,
        output: e.new_value || '',
        chosen: true,  // User's edit is the preferred version
        score: 0.9,
        metadata: {
          reportId: e.report_id,
          reportType: e.type,
          concepts: this.getReportConcepts(e.report_id),
        },
      }));
    } catch {
      return []; // Table doesn't exist yet
    }
  }

  /**
   * Explicit feedback = accept/reject decisions
   */
  private collectFeedbackDecisions(): PreferenceDataPoint[] {
    const feedback = this.db.prepare(`
      SELECT
        f.id,
        f.report_id,
        f.action,
        f.comment,
        f.created_at,
        r.type,
        r.title,
        r.summary,
        r.decision,
        r.findings_json
      FROM feedback f
      JOIN reports r ON f.report_id = r.id
      WHERE f.action IN ('useful', 'not_useful')
      ORDER BY f.created_at DESC
    `).all() as any[];

    return feedback.map(f => ({
      id: `feedback_${f.id}`,
      type: f.action === 'useful' ? 'accepted' as const : 'rejected' as const,
      timestamp: f.created_at,
      input: `Report: ${f.title}\nType: ${f.type}`,
      output: this.buildReportOutput(f),
      chosen: f.action === 'useful',
      score: f.action === 'useful' ? 0.8 : 0.2,
      metadata: {
        reportId: f.report_id,
        reportType: f.type,
        concepts: this.getReportConcepts(f.report_id),
      },
    }));
  }

  /**
   * Engagement signals = implicit preferences from behavior
   */
  private collectEngagementSignals(): PreferenceDataPoint[] {
    // Find reports with strong engagement patterns
    const engaged = this.db.prepare(`
      SELECT
        r.id,
        r.type,
        r.title,
        r.summary,
        r.decision,
        r.findings_json,
        r.created_at,
        MAX(CASE WHEN t.event_type = 'scroll'
            THEN json_extract(t.event_data_json, '$.depth') ELSE 0 END) as max_scroll,
        MAX(CASE WHEN t.event_type = 'close'
            THEN json_extract(t.event_data_json, '$.dwell_ms') ELSE 0 END) as dwell_ms,
        COUNT(CASE WHEN t.event_type = 'click' THEN 1 END) as click_count
      FROM reports r
      JOIN telemetry t ON r.id = t.report_id
      GROUP BY r.id
      HAVING max_scroll > 0.7 OR dwell_ms > 15000 OR click_count >= 2
      ORDER BY r.created_at DESC
    `).all() as any[];

    return engaged.map(e => {
      // Calculate engagement score
      const scrollScore = (e.max_scroll || 0) * 0.4;
      const dwellScore = Math.min(1, (e.dwell_ms || 0) / 30000) * 0.3;
      const clickScore = Math.min(1, (e.click_count || 0) / 5) * 0.3;
      const totalScore = scrollScore + dwellScore + clickScore;

      return {
        id: `engagement_${e.id}`,
        type: 'engagement' as const,
        timestamp: e.created_at,
        input: `Report type: ${e.type}`,
        output: this.buildReportOutput(e),
        chosen: totalScore > 0.5,
        score: totalScore,
        metadata: {
          reportId: e.id,
          reportType: e.type,
          concepts: this.getReportConcepts(e.id),
          dwellMs: e.dwell_ms,
          scrollDepth: e.max_scroll,
        },
      };
    });
  }

  private getReportConcepts(reportId: string): string[] {
    try {
      const mentions = this.db.prepare(`
        SELECT c.label
        FROM concept_mentions cm
        JOIN concepts c ON cm.concept_id = c.id
        WHERE cm.entity_type = 'report' AND cm.entity_id = ?
          AND c.active = 1
      `).all(reportId) as any[];
      return mentions.map(m => m.label);
    } catch {
      return [];
    }
  }

  private buildInputContext(sourceTitle?: string, sourceUrl?: string, reportType?: string): string {
    const parts: string[] = [];
    if (sourceTitle) parts.push(`Source: ${sourceTitle}`);
    if (sourceUrl) parts.push(`URL: ${sourceUrl}`);
    if (reportType) parts.push(`Generate a ${reportType} report`);
    return parts.join('\n') || 'Generate a research report';
  }

  private buildReportOutput(report: any): string {
    const parts: string[] = [];
    if (report.title) parts.push(`# ${report.title}`);
    if (report.summary) parts.push(`\n${report.summary}`);
    if (report.decision) parts.push(`\n## Decision\n${report.decision}`);
    if (report.findings_json) {
      try {
        const findings = JSON.parse(report.findings_json);
        if (findings.length > 0) {
          parts.push(`\n## Findings\n${findings.map((f: string) => `- ${f}`).join('\n')}`);
        }
      } catch {}
    }
    return parts.join('') || report.title || 'Empty report';
  }

  /**
   * Convert to training examples for preference model
   */
  buildTrainingExamples(): TrainingExample[] {
    const data = this.collectPreferenceData();
    const examples: TrainingExample[] = [];

    // Group by report ID to create preference pairs
    const byReport = new Map<string, PreferenceDataPoint[]>();
    for (const d of data) {
      const reportId = d.metadata.reportId || d.id;
      if (!byReport.has(reportId)) byReport.set(reportId, []);
      byReport.get(reportId)!.push(d);
    }

    // Create pairwise examples
    for (const [reportId, points] of byReport) {
      const chosen = points.filter(p => p.chosen).sort((a, b) => b.score - a.score)[0];
      const rejected = points.filter(p => !p.chosen).sort((a, b) => a.score - b.score)[0];

      if (chosen) {
        examples.push({
          prompt: chosen.input,
          chosen: chosen.output,
          rejected: rejected?.output,
          weight: chosen.score,
        });
      }
    }

    return examples;
  }

  /**
   * Export as JSONL for fine-tuning frameworks
   */
  exportAsJSONL(): string {
    const examples = this.buildTrainingExamples();
    return examples.map(e => JSON.stringify({
      prompt: e.prompt,
      chosen: e.chosen,
      rejected: e.rejected,
      weight: e.weight,
    })).join('\n');
  }

  /**
   * Export as preference pairs for DPO/RLHF
   */
  exportAsPreferencePairs(): string {
    const examples = this.buildTrainingExamples().filter(e => e.rejected);
    return examples.map(e => JSON.stringify({
      prompt: e.prompt,
      chosen: e.chosen,
      rejected: e.rejected,
    })).join('\n');
  }

  /**
   * Get statistics about the dataset
   */
  getStats(): DatasetStats {
    const data = this.collectPreferenceData();

    const pinnedCount = data.filter(d => d.type === 'pinned').length;
    const editedCount = data.filter(d => d.type === 'edited').length;
    const acceptedCount = data.filter(d => d.type === 'accepted').length;
    const rejectedCount = data.filter(d => d.type === 'rejected').length;
    const engagementCount = data.filter(d => d.type === 'engagement').length;

    const allConcepts = new Set<string>();
    for (const d of data) {
      for (const c of d.metadata.concepts || []) {
        allConcepts.add(c);
      }
    }

    const totalConcepts = this.db.prepare(`SELECT COUNT(*) as count FROM concepts WHERE active = 1`).get() as any;
    const conceptCoverage = totalConcepts.count > 0 ? allConcepts.size / totalConcepts.count : 0;

    const timestamps = data.map(d => d.timestamp).sort();
    const dateRange = {
      start: timestamps[0] || 'N/A',
      end: timestamps[timestamps.length - 1] || 'N/A',
    };

    return {
      totalExamples: data.length,
      pinnedCount,
      editedCount,
      acceptedCount,
      rejectedCount,
      engagementCount,
      conceptCoverage,
      dateRange,
    };
  }
}

// ============================================
// TRAINING INFRASTRUCTURE
// ============================================

export interface TrainingConfig {
  modelBase: string;           // Base model to fine-tune
  method: 'lora' | 'full' | 'dpo';
  loraRank?: number;
  learningRate: number;
  epochs: number;
  batchSize: number;
  outputDir: string;
}

export interface TrainingJob {
  id: string;
  config: TrainingConfig;
  datasetPath: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  startedAt?: string;
  completedAt?: string;
  metrics?: {
    loss: number;
    accuracy: number;
    preferenceAccuracy?: number;
  };
  modelPath?: string;
}

/**
 * Manages training jobs for local fine-tuning
 */
export class TrainingManager {
  constructor(private db: Database.Database) {
    this.ensureTrainingTables();
  }

  private ensureTrainingTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS training_jobs (
        id TEXT PRIMARY KEY,
        config_json TEXT NOT NULL,
        dataset_path TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        progress REAL DEFAULT 0,
        started_at TEXT,
        completed_at TEXT,
        metrics_json TEXT,
        model_path TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS trained_models (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        name TEXT NOT NULL,
        base_model TEXT NOT NULL,
        method TEXT NOT NULL,
        model_path TEXT NOT NULL,
        metrics_json TEXT,
        is_active INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (job_id) REFERENCES training_jobs(id)
      )
    `);
  }

  /**
   * Create a new training job
   */
  createJob(config: TrainingConfig, datasetPath: string): string {
    const id = this.randomId();
    this.db.prepare(`
      INSERT INTO training_jobs (id, config_json, dataset_path)
      VALUES (?, ?, ?)
    `).run(id, JSON.stringify(config), datasetPath);
    return id;
  }

  /**
   * Update job progress
   */
  updateProgress(jobId: string, progress: number, metrics?: any): void {
    if (metrics) {
      this.db.prepare(`
        UPDATE training_jobs
        SET progress = ?, metrics_json = ?
        WHERE id = ?
      `).run(progress, JSON.stringify(metrics), jobId);
    } else {
      this.db.prepare(`
        UPDATE training_jobs SET progress = ? WHERE id = ?
      `).run(progress, jobId);
    }
  }

  /**
   * Complete a training job
   */
  completeJob(jobId: string, modelPath: string, metrics: any): void {
    this.db.prepare(`
      UPDATE training_jobs
      SET status = 'completed',
          completed_at = datetime('now'),
          model_path = ?,
          metrics_json = ?
      WHERE id = ?
    `).run(modelPath, JSON.stringify(metrics), jobId);

    // Register the trained model
    const job = this.getJob(jobId);
    if (job) {
      const modelId = this.randomId();
      const config = JSON.parse(job.config_json);
      this.db.prepare(`
        INSERT INTO trained_models (id, job_id, name, base_model, method, model_path, metrics_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(modelId, jobId, `ronald-personalized-${modelId.slice(0, 8)}`, config.modelBase, config.method, modelPath, JSON.stringify(metrics));
    }
  }

  /**
   * Fail a training job
   */
  failJob(jobId: string, error: string): void {
    this.db.prepare(`
      UPDATE training_jobs
      SET status = 'failed', metrics_json = ?
      WHERE id = ?
    `).run(JSON.stringify({ error }), jobId);
  }

  /**
   * Get job details
   */
  getJob(jobId: string): any {
    return this.db.prepare(`SELECT * FROM training_jobs WHERE id = ?`).get(jobId);
  }

  /**
   * List all trained models
   */
  listModels(): any[] {
    return this.db.prepare(`
      SELECT * FROM trained_models ORDER BY created_at DESC
    `).all();
  }

  /**
   * Set active model for inference
   */
  setActiveModel(modelId: string): void {
    this.db.prepare(`UPDATE trained_models SET is_active = 0`).run();
    this.db.prepare(`UPDATE trained_models SET is_active = 1 WHERE id = ?`).run(modelId);
  }

  /**
   * Get the active model
   */
  getActiveModel(): any {
    return this.db.prepare(`SELECT * FROM trained_models WHERE is_active = 1`).get();
  }

  /**
   * Generate training script for MLX/Apple Silicon
   */
  generateMLXTrainingScript(config: TrainingConfig, datasetPath: string): string {
    return `#!/bin/bash
# Ronald-GI Local Fine-tuning Script (MLX)
# Generated: ${new Date().toISOString()}

# Activate virtual environment
source ~/mlx-env/bin/activate

# Install/update MLX if needed
pip install -q mlx-lm

# Training configuration
MODEL="${config.modelBase}"
DATASET="${datasetPath}"
OUTPUT="${config.outputDir}"
LORA_RANK=${config.loraRank || 8}
LR=${config.learningRate}
EPOCHS=${config.epochs}
BATCH_SIZE=${config.batchSize}

echo "Starting fine-tuning..."
echo "Model: $MODEL"
echo "Dataset: $DATASET"

python -m mlx_lm.lora \\
    --model "$MODEL" \\
    --data "$DATASET" \\
    --train \\
    --iters $((EPOCHS * 100)) \\
    --batch-size $BATCH_SIZE \\
    --lora-rank $LORA_RANK \\
    --learning-rate $LR \\
    --adapter-path "$OUTPUT/adapters"

echo "Training complete! Adapters saved to $OUTPUT/adapters"

# Fuse the adapter with the base model
python -m mlx_lm.fuse \\
    --model "$MODEL" \\
    --adapter-path "$OUTPUT/adapters" \\
    --save-path "$OUTPUT/fused_model"

echo "Model fused and saved to $OUTPUT/fused_model"
`;
  }

  private randomId(): string {
    return Math.random().toString(36).substring(2, 15) +
           Math.random().toString(36).substring(2, 15);
  }
}

// ============================================
// EXPORTS
// ============================================

export function createDatasetSystem(db: Database.Database) {
  return {
    builder: new DatasetBuilder(db),
    training: new TrainingManager(db),
  };
}
