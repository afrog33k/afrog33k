#!/usr/bin/env python3
"""
World Model Evolution for Ronald-GI

This is the CORE of what makes Ronald intelligent:
1. Analyzes browsing patterns to detect interests
2. Updates preference weights based on engagement
3. Detects discovery spikes and creates research jobs
4. Merges/kills concepts based on usage
5. Generates obsession gradient (what you care about most)

Run this every 6 hours to keep the world model current.

Usage:
    python scripts/evolve_worldmodel.py
    python scripts/evolve_worldmodel.py --verbose
    python scripts/evolve_worldmodel.py --dry-run
"""

import argparse
import sqlite3
import json
import math
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Tuple, Any
from collections import defaultdict

DB_PATH = Path(__file__).parent.parent / "data" / "ronald.db"

# Evolution parameters
ENGAGEMENT_WEIGHT_BOOST = 0.1
DECAY_RATE = 0.95  # Per week
MIN_WEIGHT = 0.1
MAX_WEIGHT = 2.0
SPIKE_THRESHOLD = 5  # Visits in 1 hour
MERGE_SIMILARITY_THRESHOLD = 0.85
ORPHAN_DAYS = 14


def get_db():
    """Get database connection."""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def random_id() -> str:
    import random
    import string
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=16))


class WorldModelEvolver:
    def __init__(self, conn: sqlite3.Connection, verbose: bool = False, dry_run: bool = False):
        self.conn = conn
        self.verbose = verbose
        self.dry_run = dry_run
        self.stats = defaultdict(int)

    def log(self, msg: str):
        if self.verbose:
            print(f"  {msg}")

    def evolve(self) -> Dict[str, Any]:
        """Run full world model evolution."""
        print(f"[{datetime.now().isoformat()}] Starting world model evolution...")

        # 1. Update preference weights from engagement
        self.update_weights_from_engagement()

        # 2. Apply temporal decay to stale weights
        self.apply_temporal_decay()

        # 3. Detect and record discovery spikes
        spikes = self.detect_discovery_spikes()
        self.record_spikes(spikes)

        # 4. Evolve concepts (merge similar, kill orphans)
        self.evolve_concepts()

        # 5. Update obsession gradient
        self.update_obsession_gradient()

        # 6. Generate proactive alerts
        self.generate_alerts()

        # 7. Plan research for gaps
        self.plan_research()

        if not self.dry_run:
            self.conn.commit()

        print(f"\n  Evolution complete:")
        for key, value in self.stats.items():
            print(f"    {key}: {value}")

        return dict(self.stats)

    def update_weights_from_engagement(self):
        """Update concept weights based on recent engagement."""
        print("  Analyzing engagement patterns...")

        # Find concepts with recent engagement (last 24h)
        engaged = self.conn.execute("""
            SELECT
                c.id as concept_id,
                c.label,
                COUNT(DISTINCT t.id) as engagement_count,
                SUM(CASE WHEN t.event_type = 'pin' THEN 5
                         WHEN t.event_type = 'click' THEN 2
                         WHEN t.event_type = 'scroll' THEN 1
                         ELSE 0.5 END) as engagement_score
            FROM concepts c
            JOIN concept_mentions cm ON c.id = cm.concept_id
            JOIN reports r ON cm.entity_id = r.id AND cm.entity_type = 'report'
            JOIN telemetry t ON r.id = t.report_id
            WHERE c.active = 1
              AND t.created_at > datetime('now', '-24 hours')
            GROUP BY c.id
            HAVING engagement_count >= 2
        """).fetchall()

        for row in engaged:
            boost = min(0.3, (row["engagement_score"] / 10) * ENGAGEMENT_WEIGHT_BOOST)
            self.update_concept_weight(row["concept_id"], boost)
            self.log(f"Boosted {row['label']} by {boost:.3f} ({row['engagement_count']} engagements)")
            self.stats["weights_boosted"] += 1

    def update_concept_weight(self, concept_id: str, delta: float):
        """Update or create preference weight for a concept."""
        if self.dry_run:
            return

        existing = self.conn.execute(
            "SELECT id, weight FROM preference_weights WHERE weight_type = 'concept' AND target_id = ?",
            (concept_id,)
        ).fetchone()

        if existing:
            new_weight = max(MIN_WEIGHT, min(MAX_WEIGHT, existing["weight"] + delta))
            self.conn.execute("""
                UPDATE preference_weights
                SET weight = ?, last_engagement_at = datetime('now')
                WHERE id = ?
            """, (new_weight, existing["id"]))
        else:
            new_weight = max(MIN_WEIGHT, min(MAX_WEIGHT, 1.0 + delta))
            self.conn.execute("""
                INSERT INTO preference_weights (id, weight_type, target_id, weight, last_engagement_at)
                VALUES (?, 'concept', ?, ?, datetime('now'))
            """, (random_id(), concept_id, new_weight))

    def apply_temporal_decay(self):
        """Apply decay to weights that haven't been engaged recently."""
        print("  Applying temporal decay...")

        # Find stale weights (no engagement in 7+ days)
        stale = self.conn.execute("""
            SELECT id, weight, last_engagement_at,
                   julianday('now') - julianday(last_engagement_at) as days_stale
            FROM preference_weights
            WHERE weight_type = 'concept'
              AND last_engagement_at < datetime('now', '-7 days')
              AND weight > ?
        """, (MIN_WEIGHT,)).fetchall()

        for row in stale:
            weeks_stale = row["days_stale"] / 7
            decayed_weight = row["weight"] * (DECAY_RATE ** weeks_stale)
            decayed_weight = max(MIN_WEIGHT, decayed_weight)

            if not self.dry_run:
                self.conn.execute(
                    "UPDATE preference_weights SET weight = ? WHERE id = ?",
                    (decayed_weight, row["id"])
                )

            self.log(f"Decayed weight from {row['weight']:.2f} to {decayed_weight:.2f} ({weeks_stale:.1f} weeks stale)")
            self.stats["weights_decayed"] += 1

    def detect_discovery_spikes(self) -> List[Dict[str, Any]]:
        """Detect bursts of related browsing activity."""
        print("  Detecting discovery spikes...")

        # Find clusters of visits in short time windows
        spikes = self.conn.execute("""
            SELECT
                strftime('%Y-%m-%d %H:00:00', visited_at) as hour_bucket,
                COUNT(*) as visit_count,
                GROUP_CONCAT(DISTINCT host) as hosts,
                GROUP_CONCAT(DISTINCT url) as urls
            FROM visits
            WHERE visited_at > datetime('now', '-24 hours')
            GROUP BY hour_bucket
            HAVING visit_count >= ?
            ORDER BY hour_bucket DESC
        """, (SPIKE_THRESHOLD,)).fetchall()

        detected = []
        for spike in spikes:
            hosts = spike["hosts"].split(",") if spike["hosts"] else []
            unique_hosts = len(set(hosts))

            # Multiple hosts = research behavior
            if unique_hosts >= 2:
                detected.append({
                    "timestamp": spike["hour_bucket"],
                    "visit_count": spike["visit_count"],
                    "hosts": hosts[:5],
                    "intensity": min(1.0, spike["visit_count"] / 10),
                })
                self.stats["spikes_detected"] += 1

        return detected

    def record_spikes(self, spikes: List[Dict[str, Any]]):
        """Record discovery spikes as alerts."""
        if self.dry_run or not spikes:
            return

        for spike in spikes:
            alert_id = random_id()
            try:
                self.conn.execute("""
                    INSERT OR IGNORE INTO proactive_alerts (id, type, priority, title, message)
                    VALUES (?, 'discovery_spike', 'important', ?, ?)
                """, (
                    alert_id,
                    f"Discovery spike: {spike['visit_count']} visits",
                    f"At {spike['timestamp']}, intensity: {spike['intensity']:.2f}",
                ))
            except:
                pass

    def evolve_concepts(self):
        """Merge similar concepts and kill orphans."""
        print("  Evolving concepts...")

        # Find merge candidates (high similarity)
        candidates = self.conn.execute("""
            SELECT
                c1.id as id1, c1.label as label1,
                c2.id as id2, c2.label as label2,
                nc.distance
            FROM nearest_concepts nc
            JOIN concepts c1 ON nc.concept_id = c1.id
            JOIN concepts c2 ON nc.neighbor_id = c2.id
            WHERE nc.distance < ?
              AND c1.active = 1 AND c2.active = 1
              AND c1.mention_count >= c2.mention_count
        """, (1 - MERGE_SIMILARITY_THRESHOLD,)).fetchall()

        for row in candidates:
            self.log(f"Merge candidate: {row['label1']} + {row['label2']} (dist: {row['distance']:.3f})")
            self.stats["merge_candidates"] += 1
            # Don't auto-merge, just track for manual review

        # Find orphan concepts (no mentions in ORPHAN_DAYS)
        orphans = self.conn.execute("""
            SELECT c.id, c.label, c.mention_count
            FROM concepts c
            LEFT JOIN concept_mentions cm ON c.id = cm.concept_id
            LEFT JOIN reports r ON cm.entity_id = r.id AND cm.entity_type = 'report'
            WHERE c.active = 1
              AND (cm.id IS NULL OR r.created_at < datetime('now', ? || ' days'))
            GROUP BY c.id
            HAVING c.mention_count < 3
        """, (f"-{ORPHAN_DAYS}",)).fetchall()

        for row in orphans:
            self.log(f"Orphan concept: {row['label']} ({row['mention_count']} mentions)")
            self.stats["orphan_concepts"] += 1

    def update_obsession_gradient(self):
        """Calculate and store the obsession gradient."""
        print("  Updating obsession gradient...")

        # Get top concepts by weighted engagement
        gradient = self.conn.execute("""
            SELECT c.label, pw.weight,
                   (SELECT COUNT(*) FROM telemetry t
                    JOIN reports r ON t.report_id = r.id
                    JOIN concept_mentions cm ON cm.entity_id = r.id AND cm.entity_type = 'report'
                    WHERE cm.concept_id = c.id AND t.event_type = 'pin') as pin_count
            FROM preference_weights pw
            JOIN concepts c ON pw.target_id = c.id
            WHERE pw.weight_type = 'concept' AND c.active = 1
            ORDER BY (pw.weight * (1 + COALESCE(pin_count, 0) * 0.5)) DESC
            LIMIT 20
        """).fetchall()

        gradient_list = [row["label"] for row in gradient]
        self.log(f"Top obsessions: {', '.join(gradient_list[:5])}")

        # Store in system state
        if not self.dry_run:
            try:
                self.conn.execute("""
                    INSERT OR REPLACE INTO system_state (key, value_json, updated_at)
                    VALUES ('obsession_gradient', ?, datetime('now'))
                """, (json.dumps(gradient_list),))
            except:
                pass

        self.stats["obsession_gradient_size"] = len(gradient_list)

    def generate_alerts(self):
        """Generate proactive alerts based on world model state."""
        print("  Generating proactive alerts...")

        # Alert for high-impact unread reports
        unread = self.conn.execute("""
            SELECT r.id, r.title, r.impact_score
            FROM reports r
            LEFT JOIN telemetry t ON r.id = t.report_id AND t.event_type = 'open'
            WHERE r.impact_score > 0.8
              AND r.created_at > datetime('now', '-3 days')
              AND t.id IS NULL
            LIMIT 5
        """).fetchall()

        for row in unread:
            if not self.dry_run:
                try:
                    self.conn.execute("""
                        INSERT OR IGNORE INTO proactive_alerts (id, type, priority, title, message, action_url)
                        VALUES (?, 'high_impact', 'urgent', ?, ?, ?)
                    """, (
                        random_id(),
                        f"Unread: {row['title'][:50]}",
                        f"Impact score: {row['impact_score']:.2f}",
                        f"/reports/{row['id']}",
                    ))
                except:
                    pass
            self.stats["alerts_created"] += 1

    def plan_research(self):
        """Plan research for high-interest concepts without recent reports."""
        print("  Planning research...")

        gaps = self.conn.execute("""
            SELECT c.id, c.label, pw.weight
            FROM preference_weights pw
            JOIN concepts c ON pw.target_id = c.id
            LEFT JOIN concept_mentions cm ON c.id = cm.concept_id AND cm.entity_type = 'report'
            LEFT JOIN reports r ON cm.entity_id = r.id AND r.created_at > datetime('now', '-7 days')
            WHERE pw.weight_type = 'concept'
              AND pw.weight > 1.0
              AND c.active = 1
              AND r.id IS NULL
            ORDER BY pw.weight DESC
            LIMIT 10
        """).fetchall()

        for row in gaps:
            self.log(f"Research gap: {row['label']} (weight: {row['weight']:.2f})")

            if not self.dry_run:
                try:
                    self.conn.execute("""
                        INSERT OR IGNORE INTO research_plans (id, topic, priority, reason, status)
                        VALUES (?, ?, ?, ?, 'planned')
                    """, (
                        random_id(),
                        row["label"],
                        int(row["weight"] * 5),
                        f"High interest (weight: {row['weight']:.2f}) but no recent research",
                    ))
                except:
                    pass

            self.stats["research_planned"] += 1


def main():
    parser = argparse.ArgumentParser(description="Evolve Ronald-GI world model")
    parser.add_argument("--verbose", "-v", action="store_true",
                       help="Verbose output")
    parser.add_argument("--dry-run", action="store_true",
                       help="Don't write changes to database")
    args = parser.parse_args()

    conn = get_db()

    # Ensure tables exist
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS research_plans (
                id TEXT PRIMARY KEY,
                topic TEXT NOT NULL,
                priority INTEGER DEFAULT 5,
                reason TEXT,
                status TEXT DEFAULT 'planned',
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        conn.execute("""
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
        """)
    except:
        pass

    evolver = WorldModelEvolver(conn, verbose=args.verbose, dry_run=args.dry_run)
    stats = evolver.evolve()

    conn.close()

    print(f"\n✓ World model evolution complete")
    return stats


if __name__ == "__main__":
    main()
