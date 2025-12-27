#!/usr/bin/env python3
"""
Cluster visits into browsing sessions and calculate interest intensity.
Implements:
- Visit embedding pipeline
- Time-based clustering (session detection)
- Burst score calculation (topic concentration)
- Novelty score calculation (new vs repeated)
- Intensity score (0.6*burst + 0.4*novelty)
"""

import json
import sqlite3
import os
import struct
from datetime import datetime, timedelta
from collections import defaultdict
from urllib.parse import urlparse
from urllib.request import urlopen, Request

# Configuration
DB_PATH = os.environ.get("DATABASE_PATH", "/worktrees/afrog33k/dexter/data/ronald.db")
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
EMBED_MODEL = os.environ.get("EMBED_MODEL", "nomic-embed-text")

# Session clustering parameters
SESSION_GAP_MINUTES = 30  # Gap to start new session
MIN_SESSION_VISITS = 3    # Minimum visits for valid session

# Scoring weights
BURST_WEIGHT = 0.6
NOVELTY_WEIGHT = 0.4


def uid() -> str:
    """Generate a unique ID."""
    import uuid
    return uuid.uuid4().hex


def get_embedding(text: str) -> list:
    """Get embedding from Ollama."""
    payload = json.dumps({"model": EMBED_MODEL, "input": text[:8000]}).encode()
    req = Request(
        f"{OLLAMA_URL}/api/embed",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    try:
        with urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
            return data.get("embeddings", [[]])[0]
    except Exception as e:
        print(f"  Embedding error: {e}")
        return []


def cosine_similarity(a: list, b: list) -> float:
    """Calculate cosine similarity between two vectors."""
    import math
    if not a or not b:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def cluster_visits_by_time(visits: list) -> list:
    """Cluster visits into sessions based on time gaps."""
    if not visits:
        return []

    sessions = []
    current_session = []

    prev_time = None
    for visit in visits:
        visit_time = datetime.fromisoformat(visit["visited_at"].replace("Z", "+00:00"))

        if prev_time is None:
            current_session.append(visit)
        else:
            gap = visit_time - prev_time
            if gap > timedelta(minutes=SESSION_GAP_MINUTES):
                # New session
                if len(current_session) >= MIN_SESSION_VISITS:
                    sessions.append(current_session)
                current_session = [visit]
            else:
                current_session.append(visit)

        prev_time = visit_time

    # Add last session
    if len(current_session) >= MIN_SESSION_VISITS:
        sessions.append(current_session)

    return sessions


def calculate_burst_score(session: list) -> float:
    """
    Calculate burst score - how concentrated the session is on specific topics.
    High burst = focused browsing on related content.
    """
    if len(session) < 2:
        return 0.0

    # Get host concentration
    hosts = defaultdict(int)
    for visit in session:
        hosts[visit["host"]] += 1

    # Entropy-based concentration
    total = len(session)
    entropy = 0.0
    for count in hosts.values():
        p = count / total
        if p > 0:
            import math
            entropy -= p * math.log2(p)

    # Max entropy for uniform distribution
    max_entropy = 0.0
    if len(hosts) > 1:
        import math
        max_entropy = math.log2(len(hosts))

    # Invert: low entropy = high concentration = high burst
    if max_entropy > 0:
        concentration = 1.0 - (entropy / max_entropy)
    else:
        concentration = 1.0

    return concentration


def calculate_novelty_score(session: list, visit_history: dict) -> float:
    """
    Calculate novelty score - how new/unexplored the content is.
    High novelty = visiting new sites not seen before.
    """
    if not session:
        return 0.0

    new_hosts = 0
    for visit in session:
        host = visit["host"]
        if host not in visit_history or visit_history[host] <= 1:
            new_hosts += 1

    return new_hosts / len(session)


def get_session_stats(session: list) -> dict:
    """Calculate statistics for a session."""
    hosts = defaultdict(int)
    for visit in session:
        hosts[visit["host"]] += 1

    start_time = min(v["visited_at"] for v in session)
    end_time = max(v["visited_at"] for v in session)

    return {
        "visit_count": len(session),
        "hosts": dict(hosts),
        "unique_hosts": len(hosts),
        "started_at": start_time,
        "ended_at": end_time,
    }


def main():
    print("=== Visit Clustering ===")
    print(f"Database: {DB_PATH}")
    print()

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Get all visits ordered by time
    print("Loading visits...")
    cursor.execute("""
        SELECT id, url, title, host, visited_at, embedding, metadata_json
        FROM visits
        WHERE host IS NOT NULL
        ORDER BY visited_at ASC
    """)
    visits = [dict(row) for row in cursor.fetchall()]
    print(f"Found {len(visits)} visits")

    if not visits:
        print("No visits to cluster")
        return

    # Build visit history (for novelty calculation)
    visit_history = defaultdict(int)
    for visit in visits:
        visit_history[visit["host"]] += 1

    # Cluster into sessions
    print("\nClustering into sessions...")
    sessions = cluster_visits_by_time(visits)
    print(f"Found {len(sessions)} sessions")

    if not sessions:
        print("No valid sessions found")
        return

    # Process each session
    clusters_created = 0
    embeddings_generated = 0

    for i, session in enumerate(sessions):
        stats = get_session_stats(session)

        # Calculate scores
        burst = calculate_burst_score(session)
        novelty = calculate_novelty_score(session, visit_history)
        intensity = BURST_WEIGHT * burst + NOVELTY_WEIGHT * novelty

        print(f"\n[Session {i+1}]")
        print(f"  Visits: {stats['visit_count']}, Hosts: {stats['unique_hosts']}")
        print(f"  Burst: {burst:.2f}, Novelty: {novelty:.2f}, Intensity: {intensity:.2f}")
        print(f"  Top hosts: {list(stats['hosts'].keys())[:3]}")

        # Generate session embedding (average of visit embeddings or new)
        session_text = " ".join([
            f"{v['title'] or ''} {v['host']}"
            for v in session[:10]  # Limit to first 10 for embedding
        ])

        embedding = None
        if session_text.strip():
            embedding = get_embedding(session_text)
            if embedding:
                embeddings_generated += 1
                embedding_blob = struct.pack(f'{len(embedding)}f', *embedding)
            else:
                embedding_blob = None
        else:
            embedding_blob = None

        # Check if cluster already exists for this time range
        cursor.execute("""
            SELECT id FROM visit_clusters
            WHERE started_at = ? AND ended_at = ?
        """, (stats["started_at"], stats["ended_at"]))

        if cursor.fetchone():
            print("  (already exists)")
            continue

        # Create cluster record
        cluster_id = uid()
        cursor.execute("""
            INSERT INTO visit_clusters (
                id, started_at, ended_at, visit_count,
                burst_score, novelty_score, intensity,
                stats_json, urls_json, embedding
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            cluster_id,
            stats["started_at"],
            stats["ended_at"],
            stats["visit_count"],
            burst,
            novelty,
            intensity,
            json.dumps(stats),
            json.dumps([v["url"] for v in session]),
            embedding_blob
        ))

        # Link visits to cluster
        for visit in session:
            cursor.execute("""
                UPDATE visits SET cluster_id = ? WHERE id = ?
            """, (cluster_id, visit["id"]))

        clusters_created += 1
        conn.commit()

    print("\n" + "=" * 40)
    print("RESULTS")
    print("=" * 40)
    print(f"Sessions found: {len(sessions)}")
    print(f"Clusters created: {clusters_created}")
    print(f"Embeddings generated: {embeddings_generated}")

    # Show top clusters by intensity
    cursor.execute("""
        SELECT id, intensity, burst_score, novelty_score, visit_count, started_at
        FROM visit_clusters
        ORDER BY intensity DESC
        LIMIT 10
    """)
    print("\nTop 10 clusters by intensity:")
    for row in cursor.fetchall():
        print(f"  {row['intensity']:.2f} (burst={row['burst_score']:.2f}, novelty={row['novelty_score']:.2f}) "
              f"- {row['visit_count']} visits @ {row['started_at'][:10]}")

    conn.close()


if __name__ == "__main__":
    main()
