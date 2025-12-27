#!/usr/bin/env python3
"""
Compute nearest neighbor caches for concepts, reports, and visit clusters.
Uses embeddings to find similar items and caches results for fast lookup.
"""

import sqlite3
import struct
import os
import math
from datetime import datetime
from typing import List, Tuple, Optional

# Configuration
DB_PATH = os.environ.get("DATABASE_PATH", "/worktrees/afrog33k/dexter/data/ronald.db")
TOP_K = 10  # Number of neighbors to cache


def uid() -> str:
    """Generate a unique ID."""
    import uuid
    return uuid.uuid4().hex


def unpack_embedding(blob: bytes) -> List[float]:
    """Unpack embedding from blob."""
    if not blob:
        return []
    count = len(blob) // 4
    return list(struct.unpack(f'{count}f', blob))


def cosine_similarity(a: List[float], b: List[float]) -> float:
    """Calculate cosine similarity between two vectors."""
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def compute_nearest_concepts(conn: sqlite3.Connection) -> int:
    """Compute nearest neighbors for concepts."""
    cursor = conn.cursor()

    # Get all concepts with embeddings
    cursor.execute("""
        SELECT id, label, embedding
        FROM concepts
        WHERE active = 1 AND embedding IS NOT NULL
    """)
    concepts = [(row[0], row[1], unpack_embedding(row[2])) for row in cursor.fetchall()]

    if len(concepts) < 2:
        print("  Not enough concepts with embeddings")
        return 0

    # Clear existing cache
    cursor.execute("DELETE FROM nearest_concepts")

    cached = 0
    for i, (id_a, label_a, emb_a) in enumerate(concepts):
        if not emb_a:
            continue

        # Calculate similarity to all others
        similarities = []
        for id_b, label_b, emb_b in concepts:
            if id_a == id_b or not emb_b:
                continue
            sim = cosine_similarity(emb_a, emb_b)
            similarities.append((id_b, sim))

        # Sort by similarity (highest first) and take top K
        similarities.sort(key=lambda x: x[1], reverse=True)
        top_neighbors = similarities[:TOP_K]

        # Insert into cache
        for rank, (neighbor_id, sim) in enumerate(top_neighbors):
            cursor.execute("""
                INSERT INTO nearest_concepts (concept_id, neighbor_id, distance, rank)
                VALUES (?, ?, ?, ?)
            """, (id_a, neighbor_id, 1.0 - sim, rank + 1))  # distance = 1 - similarity
            cached += 1

        if (i + 1) % 50 == 0:
            print(f"    Processed {i + 1}/{len(concepts)} concepts...")

    conn.commit()
    return cached


def compute_nearest_reports(conn: sqlite3.Connection) -> int:
    """Compute nearest neighbors for reports based on shared concepts."""
    cursor = conn.cursor()

    # Get all reports with their concepts
    cursor.execute("""
        SELECT id, title, concept_ids_json
        FROM reports
        WHERE concept_ids_json IS NOT NULL AND concept_ids_json != '[]'
    """)

    import json
    reports = []
    for row in cursor.fetchall():
        try:
            concepts = set(json.loads(row[2] or '[]'))
            if concepts:
                reports.append((row[0], row[1], concepts))
        except:
            pass

    if len(reports) < 2:
        print("  Not enough reports with concepts")
        return 0

    # Clear existing cache
    cursor.execute("DELETE FROM nearest_reports")

    cached = 0
    for i, (id_a, title_a, concepts_a) in enumerate(reports):
        # Calculate Jaccard similarity to all others
        similarities = []
        for id_b, title_b, concepts_b in reports:
            if id_a == id_b:
                continue
            intersection = len(concepts_a & concepts_b)
            union = len(concepts_a | concepts_b)
            jaccard = intersection / union if union > 0 else 0
            if jaccard > 0:
                similarities.append((id_b, jaccard))

        # Sort by similarity and take top K
        similarities.sort(key=lambda x: x[1], reverse=True)
        top_neighbors = similarities[:TOP_K]

        # Insert into cache
        for rank, (neighbor_id, sim) in enumerate(top_neighbors):
            cursor.execute("""
                INSERT INTO nearest_reports (report_id, neighbor_id, distance, rank)
                VALUES (?, ?, ?, ?)
            """, (id_a, neighbor_id, 1.0 - sim, rank + 1))
            cached += 1

        if (i + 1) % 50 == 0:
            print(f"    Processed {i + 1}/{len(reports)} reports...")

    conn.commit()
    return cached


def compute_nearest_visits(conn: sqlite3.Connection) -> int:
    """Compute nearest neighbors for visit clusters."""
    cursor = conn.cursor()

    # Get all clusters with embeddings
    cursor.execute("""
        SELECT id, started_at, embedding
        FROM visit_clusters
        WHERE embedding IS NOT NULL
    """)
    clusters = [(row[0], row[1], unpack_embedding(row[2])) for row in cursor.fetchall()]

    if len(clusters) < 2:
        print("  Not enough clusters with embeddings")
        return 0

    # Clear existing cache
    cursor.execute("DELETE FROM nearest_visits")

    cached = 0
    for i, (id_a, start_a, emb_a) in enumerate(clusters):
        if not emb_a:
            continue

        # Calculate similarity to all others
        similarities = []
        for id_b, start_b, emb_b in clusters:
            if id_a == id_b or not emb_b:
                continue
            sim = cosine_similarity(emb_a, emb_b)
            similarities.append((id_b, sim))

        # Sort by similarity and take top K
        similarities.sort(key=lambda x: x[1], reverse=True)
        top_neighbors = similarities[:TOP_K]

        # Insert into cache
        for rank, (neighbor_id, sim) in enumerate(top_neighbors):
            cursor.execute("""
                INSERT INTO nearest_visits (cluster_id, neighbor_id, distance, rank)
                VALUES (?, ?, ?, ?)
            """, (id_a, neighbor_id, 1.0 - sim, rank + 1))
            cached += 1

        if (i + 1) % 20 == 0:
            print(f"    Processed {i + 1}/{len(clusters)} clusters...")

    conn.commit()
    return cached


def main():
    print("=== Computing Nearest Neighbor Caches ===")
    print(f"Database: {DB_PATH}")
    print(f"Top K neighbors: {TOP_K}")
    print()

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    # Compute concept neighbors
    print("[1/3] Computing nearest concepts...")
    concept_cached = compute_nearest_concepts(conn)
    print(f"  Cached {concept_cached} concept neighbor pairs")

    # Compute report neighbors
    print("\n[2/3] Computing nearest reports...")
    report_cached = compute_nearest_reports(conn)
    print(f"  Cached {report_cached} report neighbor pairs")

    # Compute visit cluster neighbors
    print("\n[3/3] Computing nearest visit clusters...")
    visit_cached = compute_nearest_visits(conn)
    print(f"  Cached {visit_cached} cluster neighbor pairs")

    print("\n" + "=" * 40)
    print("SUMMARY")
    print("=" * 40)
    print(f"Concept neighbors: {concept_cached}")
    print(f"Report neighbors: {report_cached}")
    print(f"Visit neighbors: {visit_cached}")
    print(f"Total cached: {concept_cached + report_cached + visit_cached}")

    conn.close()


if __name__ == "__main__":
    main()
