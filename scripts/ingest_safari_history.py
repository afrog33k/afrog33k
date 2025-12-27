#!/usr/bin/env python3
"""
Ingest Safari browsing history as visits for Ronald-GI
"""

import json
import sqlite3
import os
import shutil
import tempfile
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

# Configuration
DB_PATH = os.environ.get("DATABASE_PATH", "/worktrees/afrog33k/dexter/data/ronald.db")
SAFARI_HISTORY_PATH = os.path.expanduser("~/Library/Safari/History.db")
DAYS_BACK = int(os.environ.get("DAYS_BACK", "30"))

# Safari stores dates as seconds since 2001-01-01
SAFARI_EPOCH_OFFSET = 978307200  # Seconds between 1970-01-01 and 2001-01-01

# Hosts to exclude (noisy/low-value)
EXCLUDE_HOSTS = {
    "localhost",
    "127.0.0.1",
    "google.com",
    "www.google.com",
    "google.co.uk",
    "accounts.google.com",
    "mail.google.com",
    "www.youtube.com",
    "youtube.com",
    "facebook.com",
    "www.facebook.com",
    "twitter.com",
    "x.com",
    "instagram.com",
    "www.instagram.com",
    "linkedin.com",
    "www.linkedin.com",
    "amazon.com",
    "www.amazon.com",
    "netflix.com",
    "www.netflix.com",
}


def uid() -> str:
    """Generate a unique ID."""
    import uuid
    return uuid.uuid4().hex


def extract_host(url: str) -> str:
    """Extract host from URL."""
    try:
        parsed = urlparse(url)
        return parsed.netloc.lower()
    except:
        return ""


def should_include(url: str, host: str) -> bool:
    """Check if URL should be included."""
    if not url or not host:
        return False
    if host in EXCLUDE_HOSTS:
        return False
    if not url.startswith(("http://", "https://")):
        return False
    # Exclude localhost variants
    if "localhost" in host or "127.0.0.1" in host or "192.168." in host:
        return False
    return True


def main():
    print(f"=== Ingesting Safari History ===")
    print(f"Database: {DB_PATH}")
    print(f"Safari History: {SAFARI_HISTORY_PATH}")
    print(f"Days back: {DAYS_BACK}")
    print()

    # Check if Safari history exists
    if not os.path.exists(SAFARI_HISTORY_PATH):
        print(f"Safari history not found at {SAFARI_HISTORY_PATH}")
        print("This script requires macOS with Safari.")
        return

    # Copy Safari DB to temp location (it may be locked)
    temp_dir = tempfile.mkdtemp()
    temp_db = os.path.join(temp_dir, "History.db")

    try:
        shutil.copy2(SAFARI_HISTORY_PATH, temp_db)
        # Also copy WAL if exists
        wal_path = SAFARI_HISTORY_PATH + "-wal"
        if os.path.exists(wal_path):
            shutil.copy2(wal_path, temp_db + "-wal")
    except PermissionError:
        print("Permission denied. Grant Terminal full disk access in System Preferences.")
        return

    # Connect to Safari history
    safari_conn = sqlite3.connect(temp_db)
    safari_conn.row_factory = sqlite3.Row
    safari_cursor = safari_conn.cursor()

    # Connect to Ronald DB
    ronald_conn = sqlite3.connect(DB_PATH)
    ronald_cursor = ronald_conn.cursor()

    # Calculate date cutoff
    cutoff_timestamp = datetime.now().timestamp() - (DAYS_BACK * 86400) - SAFARI_EPOCH_OFFSET

    # Query Safari history
    # Safari schema: history_items (id, url, domain_expansion, visit_count, daily_visit_counts)
    # history_visits (id, history_item, visit_time, title, load_successful, redirect_source)
    print("Querying Safari history...")

    safari_cursor.execute("""
        SELECT
            hi.url,
            hv.title,
            hv.visit_time,
            hi.visit_count
        FROM history_items hi
        JOIN history_visits hv ON hv.history_item = hi.id
        WHERE hv.visit_time > ?
          AND hv.load_successful = 1
        ORDER BY hv.visit_time DESC
    """, (cutoff_timestamp,))

    visits = safari_cursor.fetchall()
    print(f"Found {len(visits)} visits in the last {DAYS_BACK} days")
    print()

    visits_added = 0
    skipped = 0

    for visit in visits:
        url = visit["url"]
        title = visit["title"] or ""
        visit_time = visit["visit_time"] + SAFARI_EPOCH_OFFSET
        visit_count = visit["visit_count"] or 1

        host = extract_host(url)

        if not should_include(url, host):
            skipped += 1
            continue

        # Check if visit already exists
        ronald_cursor.execute(
            "SELECT id FROM visits WHERE url = ? AND visited_at = datetime(?, 'unixepoch')",
            (url, visit_time)
        )
        if ronald_cursor.fetchone():
            continue

        # Insert visit
        visit_id = uid()
        try:
            ronald_cursor.execute("""
                INSERT INTO visits (id, url, title, host, visited_at, metadata_json)
                VALUES (?, ?, ?, ?, datetime(?, 'unixepoch'), ?)
            """, (
                visit_id,
                url[:2000],
                title[:500],
                host,
                visit_time,
                json.dumps({
                    "source": "safari",
                    "visit_count": visit_count,
                })
            ))
            visits_added += 1

            if visits_added % 100 == 0:
                print(f"  Added {visits_added} visits...")
                ronald_conn.commit()
        except Exception as e:
            print(f"  Error adding visit: {e}")
            continue

    ronald_conn.commit()

    # Cleanup
    safari_conn.close()
    shutil.rmtree(temp_dir)

    print()
    print("=== Ingestion Complete ===")
    print(f"Visits added: {visits_added}")
    print(f"Visits skipped: {skipped}")

    # Show stats
    ronald_cursor.execute("SELECT COUNT(*) FROM visits")
    print(f"Total visits: {ronald_cursor.fetchone()[0]}")

    ronald_cursor.execute("""
        SELECT host, COUNT(*) as cnt
        FROM visits
        GROUP BY host
        ORDER BY cnt DESC
        LIMIT 10
    """)
    print("\nTop 10 hosts:")
    for row in ronald_cursor.fetchall():
        print(f"  {row[1]:4d}  {row[0]}")

    ronald_conn.close()


if __name__ == "__main__":
    main()
