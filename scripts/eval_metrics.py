#!/usr/bin/env python3
"""
Evaluation metrics for Ronald-GI system
Measures quality, performance, and effectiveness
"""

import json
import sqlite3
import os
import sys
from datetime import datetime, timedelta
from typing import Dict, List, Any
from dataclasses import dataclass, asdict
import statistics

# Configuration
DB_PATH = os.environ.get("DATABASE_PATH", "/worktrees/afrog33k/dexter/data/ronald.db")


@dataclass
class EvalMetrics:
    """Evaluation metrics container."""
    # Data Quality
    sources_count: int = 0
    docs_count: int = 0
    docs_with_embeddings: int = 0
    embedding_coverage: float = 0.0

    # Concept Quality
    concepts_count: int = 0
    concepts_per_doc_avg: float = 0.0
    concepts_per_doc_std: float = 0.0
    orphan_concepts: int = 0  # Concepts with no mentions

    # Report Quality
    reports_count: int = 0
    reports_promoted: int = 0
    promotion_rate: float = 0.0
    avg_impact_score: float = 0.0
    avg_novelty_score: float = 0.0
    avg_relevance_score: float = 0.0
    avg_blended_score: float = 0.0
    reports_with_evidence: int = 0
    evidence_coverage: float = 0.0
    avg_findings_count: float = 0.0

    # Engagement (from telemetry)
    total_views: int = 0
    total_clicks: int = 0
    avg_dwell_ms: float = 0.0
    avg_scroll_depth: float = 0.0

    # Feedback
    feedback_count: int = 0
    feedback_save_rate: float = 0.0
    feedback_dismiss_rate: float = 0.0
    feedback_dive_rate: float = 0.0

    # System Health
    pending_jobs: int = 0
    oldest_unprocessed_source_days: float = 0.0


def get_connection() -> sqlite3.Connection:
    """Get database connection."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def calculate_data_quality(conn: sqlite3.Connection) -> Dict[str, Any]:
    """Calculate data quality metrics."""
    cursor = conn.cursor()

    cursor.execute("SELECT COUNT(*) FROM sources")
    sources_count = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM docs")
    docs_count = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM docs WHERE embedding IS NOT NULL")
    docs_with_embeddings = cursor.fetchone()[0]

    embedding_coverage = docs_with_embeddings / docs_count if docs_count > 0 else 0.0

    return {
        "sources_count": sources_count,
        "docs_count": docs_count,
        "docs_with_embeddings": docs_with_embeddings,
        "embedding_coverage": embedding_coverage
    }


def calculate_concept_quality(conn: sqlite3.Connection) -> Dict[str, Any]:
    """Calculate concept quality metrics."""
    cursor = conn.cursor()

    cursor.execute("SELECT COUNT(*) FROM concepts WHERE active = 1")
    concepts_count = cursor.fetchone()[0]

    # Concepts per doc
    cursor.execute("""
        SELECT COUNT(*) as cnt FROM concept_mentions
        WHERE entity_type = 'doc'
        GROUP BY entity_id
    """)
    counts = [row[0] for row in cursor.fetchall()]
    concepts_per_doc_avg = statistics.mean(counts) if counts else 0.0
    concepts_per_doc_std = statistics.stdev(counts) if len(counts) > 1 else 0.0

    # Orphan concepts (no mentions)
    cursor.execute("""
        SELECT COUNT(*) FROM concepts c
        WHERE c.active = 1
        AND NOT EXISTS (SELECT 1 FROM concept_mentions cm WHERE cm.concept_id = c.id)
    """)
    orphan_concepts = cursor.fetchone()[0]

    return {
        "concepts_count": concepts_count,
        "concepts_per_doc_avg": concepts_per_doc_avg,
        "concepts_per_doc_std": concepts_per_doc_std,
        "orphan_concepts": orphan_concepts
    }


def calculate_report_quality(conn: sqlite3.Connection) -> Dict[str, Any]:
    """Calculate report quality metrics."""
    cursor = conn.cursor()

    cursor.execute("SELECT COUNT(*) FROM reports")
    reports_count = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM reports WHERE promoted = 1")
    reports_promoted = cursor.fetchone()[0]

    promotion_rate = reports_promoted / reports_count if reports_count > 0 else 0.0

    # Score averages
    cursor.execute("""
        SELECT
            AVG(impact_score) as avg_impact,
            AVG(novelty_score) as avg_novelty,
            AVG(relevance_score) as avg_relevance,
            AVG(blended_score) as avg_blended
        FROM reports
    """)
    row = cursor.fetchone()
    avg_impact = row["avg_impact"] or 0.0
    avg_novelty = row["avg_novelty"] or 0.0
    avg_relevance = row["avg_relevance"] or 0.0
    avg_blended = row["avg_blended"] or 0.0

    # Evidence coverage
    cursor.execute("SELECT COUNT(*) FROM reports WHERE evidence_json != '[]'")
    reports_with_evidence = cursor.fetchone()[0]
    evidence_coverage = reports_with_evidence / reports_count if reports_count > 0 else 0.0

    # Average findings count
    cursor.execute("SELECT findings_json FROM reports")
    findings_counts = []
    for row in cursor.fetchall():
        try:
            findings = json.loads(row[0] or "[]")
            findings_counts.append(len(findings))
        except:
            findings_counts.append(0)
    avg_findings = statistics.mean(findings_counts) if findings_counts else 0.0

    return {
        "reports_count": reports_count,
        "reports_promoted": reports_promoted,
        "promotion_rate": promotion_rate,
        "avg_impact_score": avg_impact,
        "avg_novelty_score": avg_novelty,
        "avg_relevance_score": avg_relevance,
        "avg_blended_score": avg_blended,
        "reports_with_evidence": reports_with_evidence,
        "evidence_coverage": evidence_coverage,
        "avg_findings_count": avg_findings
    }


def calculate_engagement(conn: sqlite3.Connection) -> Dict[str, Any]:
    """Calculate engagement metrics from telemetry."""
    cursor = conn.cursor()

    cursor.execute("SELECT COUNT(*) FROM telemetry WHERE event_type = 'open'")
    total_views = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM telemetry WHERE event_type = 'click'")
    total_clicks = cursor.fetchone()[0]

    # Extract dwell_ms from event_data_json
    cursor.execute("SELECT event_data_json FROM telemetry WHERE event_type = 'dwell'")
    dwell_values = []
    for row in cursor.fetchall():
        try:
            data = json.loads(row[0] or "{}")
            if "dwell_ms" in data:
                dwell_values.append(data["dwell_ms"])
        except:
            pass
    avg_dwell = statistics.mean(dwell_values) if dwell_values else 0.0

    # Extract scroll_depth from event_data_json
    cursor.execute("SELECT event_data_json FROM telemetry WHERE event_type = 'scroll'")
    scroll_values = []
    for row in cursor.fetchall():
        try:
            data = json.loads(row[0] or "{}")
            if "scroll_depth" in data:
                scroll_values.append(data["scroll_depth"])
        except:
            pass
    avg_scroll = statistics.mean(scroll_values) if scroll_values else 0.0

    return {
        "total_views": total_views,
        "total_clicks": total_clicks,
        "avg_dwell_ms": avg_dwell,
        "avg_scroll_depth": avg_scroll
    }


def calculate_feedback(conn: sqlite3.Connection) -> Dict[str, Any]:
    """Calculate feedback metrics."""
    cursor = conn.cursor()

    cursor.execute("SELECT COUNT(*) FROM feedback")
    feedback_count = cursor.fetchone()[0]

    if feedback_count == 0:
        return {
            "feedback_count": 0,
            "feedback_save_rate": 0.0,
            "feedback_dismiss_rate": 0.0,
            "feedback_dive_rate": 0.0
        }

    cursor.execute("SELECT COUNT(*) FROM feedback WHERE action = 'save'")
    save_count = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM feedback WHERE action = 'dismiss'")
    dismiss_count = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM feedback WHERE action = 'dive'")
    dive_count = cursor.fetchone()[0]

    return {
        "feedback_count": feedback_count,
        "feedback_save_rate": save_count / feedback_count,
        "feedback_dismiss_rate": dismiss_count / feedback_count,
        "feedback_dive_rate": dive_count / feedback_count
    }


def calculate_system_health(conn: sqlite3.Connection) -> Dict[str, Any]:
    """Calculate system health metrics."""
    cursor = conn.cursor()

    cursor.execute("SELECT COUNT(*) FROM job_queue WHERE status = 'pending'")
    pending_jobs = cursor.fetchone()[0]

    cursor.execute("""
        SELECT MIN(created_at) FROM sources
        WHERE processed_at IS NULL
    """)
    row = cursor.fetchone()
    oldest = row[0] if row else None

    oldest_days = 0.0
    if oldest:
        try:
            oldest_dt = datetime.fromisoformat(oldest.replace("Z", "+00:00"))
            oldest_days = (datetime.now() - oldest_dt.replace(tzinfo=None)).days
        except:
            pass

    return {
        "pending_jobs": pending_jobs,
        "oldest_unprocessed_source_days": oldest_days
    }


def collect_all_metrics() -> EvalMetrics:
    """Collect all evaluation metrics."""
    conn = get_connection()

    metrics = EvalMetrics()

    # Collect each category
    data_quality = calculate_data_quality(conn)
    for k, v in data_quality.items():
        setattr(metrics, k, v)

    concept_quality = calculate_concept_quality(conn)
    for k, v in concept_quality.items():
        setattr(metrics, k, v)

    report_quality = calculate_report_quality(conn)
    for k, v in report_quality.items():
        setattr(metrics, k, v)

    engagement = calculate_engagement(conn)
    for k, v in engagement.items():
        setattr(metrics, k, v)

    feedback = calculate_feedback(conn)
    for k, v in feedback.items():
        setattr(metrics, k, v)

    health = calculate_system_health(conn)
    for k, v in health.items():
        setattr(metrics, k, v)

    conn.close()
    return metrics


def print_dashboard(metrics: EvalMetrics):
    """Print metrics as dashboard."""
    print("=" * 70)
    print("RONALD-GI EVALUATION DASHBOARD")
    print("=" * 70)
    print(f"Generated: {datetime.now().isoformat()}")
    print()

    print("DATA QUALITY")
    print("-" * 40)
    print(f"  Sources:              {metrics.sources_count:>8}")
    print(f"  Documents:            {metrics.docs_count:>8}")
    print(f"  With Embeddings:      {metrics.docs_with_embeddings:>8}")
    print(f"  Embedding Coverage:   {metrics.embedding_coverage:>7.1%}")
    print()

    print("CONCEPT QUALITY")
    print("-" * 40)
    print(f"  Active Concepts:      {metrics.concepts_count:>8}")
    print(f"  Concepts/Doc (avg):   {metrics.concepts_per_doc_avg:>8.2f}")
    print(f"  Concepts/Doc (std):   {metrics.concepts_per_doc_std:>8.2f}")
    print(f"  Orphan Concepts:      {metrics.orphan_concepts:>8}")
    print()

    print("REPORT QUALITY")
    print("-" * 40)
    print(f"  Total Reports:        {metrics.reports_count:>8}")
    print(f"  Promoted Reports:     {metrics.reports_promoted:>8}")
    print(f"  Promotion Rate:       {metrics.promotion_rate:>7.1%}")
    print(f"  Avg Impact Score:     {metrics.avg_impact_score:>8.2f}")
    print(f"  Avg Novelty Score:    {metrics.avg_novelty_score:>8.2f}")
    print(f"  Avg Relevance Score:  {metrics.avg_relevance_score:>8.2f}")
    print(f"  Avg Blended Score:    {metrics.avg_blended_score:>8.2f}")
    print(f"  Reports w/ Evidence:  {metrics.reports_with_evidence:>8}")
    print(f"  Evidence Coverage:    {metrics.evidence_coverage:>7.1%}")
    print(f"  Avg Findings/Report:  {metrics.avg_findings_count:>8.2f}")
    print()

    print("ENGAGEMENT (TELEMETRY)")
    print("-" * 40)
    print(f"  Total Views:          {metrics.total_views:>8}")
    print(f"  Total Clicks:         {metrics.total_clicks:>8}")
    print(f"  Avg Dwell (ms):       {metrics.avg_dwell_ms:>8.0f}")
    print(f"  Avg Scroll Depth:     {metrics.avg_scroll_depth:>7.1%}")
    print()

    print("FEEDBACK")
    print("-" * 40)
    print(f"  Total Feedback:       {metrics.feedback_count:>8}")
    print(f"  Save Rate:            {metrics.feedback_save_rate:>7.1%}")
    print(f"  Dismiss Rate:         {metrics.feedback_dismiss_rate:>7.1%}")
    print(f"  Dive Rate:            {metrics.feedback_dive_rate:>7.1%}")
    print()

    print("SYSTEM HEALTH")
    print("-" * 40)
    print(f"  Pending Jobs:         {metrics.pending_jobs:>8}")
    print(f"  Oldest Unprocessed:   {metrics.oldest_unprocessed_source_days:>6.1f} days")
    print()

    # Overall health score
    health_score = calculate_health_score(metrics)
    print("=" * 70)
    print(f"OVERALL HEALTH SCORE: {health_score:.0f}/100")
    print("=" * 70)

    return health_score


def calculate_health_score(m: EvalMetrics) -> float:
    """Calculate overall health score (0-100)."""
    score = 0.0

    # Data quality (25 pts)
    if m.sources_count > 0:
        score += 5
    if m.docs_count > 0:
        score += 5
    score += min(15, m.embedding_coverage * 15)

    # Concept quality (20 pts)
    if m.concepts_count > 0:
        score += 10
    if m.concepts_per_doc_avg >= 2:
        score += 5
    if m.orphan_concepts == 0:
        score += 5

    # Report quality (35 pts)
    if m.reports_count > 0:
        score += 10
    if m.promotion_rate > 0.3:
        score += 5
    if m.avg_blended_score > 0.5:
        score += 10
    if m.evidence_coverage > 0.8:
        score += 5
    if m.avg_findings_count >= 3:
        score += 5

    # System health (20 pts)
    if m.pending_jobs == 0:
        score += 10
    elif m.pending_jobs < 10:
        score += 5
    if m.oldest_unprocessed_source_days < 1:
        score += 10
    elif m.oldest_unprocessed_source_days < 7:
        score += 5

    return score


def main():
    if not os.path.exists(DB_PATH):
        print(f"Database not found: {DB_PATH}")
        return 1

    metrics = collect_all_metrics()

    if len(sys.argv) > 1 and sys.argv[1] == "--json":
        print(json.dumps(asdict(metrics), indent=2))
    else:
        health_score = print_dashboard(metrics)
        return 0 if health_score >= 50 else 1


if __name__ == "__main__":
    sys.exit(main() or 0)
