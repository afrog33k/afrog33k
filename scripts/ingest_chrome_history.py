#!/usr/bin/env python3
"""
Ingest Chrome browsing history as visits for Ronald-GI
"""

import json
import sqlite3
import os
import shutil
import tempfile
import platform
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

# Configuration
DB_PATH = os.environ.get("DATABASE_PATH", "/worktrees/afrog33k/dexter/data/ronald.db")
DAYS_BACK = int(os.environ.get("DAYS_BACK", "30"))

# Chrome stores dates as microseconds since 1601-01-01 (Windows epoch)
CHROME_EPOCH_OFFSET = 11644473600  # Seconds between 1601-01-01 and 1970-01-01

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
    "newtab",
    "chrome-extension",
}


def get_chrome_history_path() -> str:
    """Get the Chrome history database path for the current OS."""
    system = platform.system()

    if system == "Darwin":  # macOS
        return os.path.expanduser("~/Library/Application Support/Google/Chrome/Default/History")
    elif system == "Linux":
        return os.path.expanduser("~/.config/google-chrome/Default/History")
    elif system == "Windows":
        return os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\User Data\Default\History")
    else:
        raise RuntimeError(f"Unsupported OS: {system}")


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
    # Exclude Chrome internal pages
    if url.startswith("chrome://") or url.startswith("chrome-extension://"):
        return False
    return True


def chrome_time_to_unix(chrome_time: int) -> float:
    """Convert Chrome timestamp to Unix timestamp."""
    # Chrome stores microseconds since 1601-01-01
    return (chrome_time / 1_000_000) - CHROME_EPOCH_OFFSET


def main():
    chrome_history_path = get_chrome_history_path()

    print(f"=== Ingesting Chrome History ===")
    print(f"Database: {DB_PATH}")
    print(f"Chrome History: {chrome_history_path}")
    print(f"Days back: {DAYS_BACK}")
    print()

    # Check if Chrome history exists
    if not os.path.exists(chrome_history_path):
        print(f"Chrome history not found at {chrome_history_path}")
        print("Make sure Chrome is installed and has been used.")
        return

    # Copy Chrome DB to temp location (it's usually locked by Chrome)
    temp_dir = tempfile.mkdtemp()
    temp_db = os.path.join(temp_dir, "History")

    try:
        shutil.copy2(chrome_history_path, temp_db)
    except PermissionError:
        print("Permission denied. Close Chrome or grant appropriate permissions.")
        return
    except Exception as e:
        print(f"Error copying history: {e}")
        return

    # Connect to Chrome history
    chrome_conn = sqlite3.connect(temp_db)
    chrome_conn.row_factory = sqlite3.Row
    chrome_cursor = chrome_conn.cursor()

    # Connect to Ronald DB
    ronald_conn = sqlite3.connect(DB_PATH)
    ronald_cursor = ronald_conn.cursor()

    # Calculate date cutoff (Chrome uses microseconds since 1601)
    cutoff_unix = datetime.now().timestamp() - (DAYS_BACK * 86400)
    cutoff_chrome = int((cutoff_unix + CHROME_EPOCH_OFFSET) * 1_000_000)

    # Query Chrome history
    # Chrome schema: urls (id, url, title, visit_count, last_visit_time)
    # visits (id, url, visit_time, from_visit, transition, segment_id)
    print("Querying Chrome history...")

    chrome_cursor.execute("""
        SELECT
            u.url,
            u.title,
            v.visit_time,
            u.visit_count
        FROM urls u
        JOIN visits v ON v.url = u.id
        WHERE v.visit_time > ?
        ORDER BY v.visit_time DESC
    """, (cutoff_chrome,))

    visits = chrome_cursor.fetchall()
    print(f"Found {len(visits)} visits in the last {DAYS_BACK} days")
    print()

    visits_added = 0
    skipped = 0

    for visit in visits:
        url = visit["url"]
        title = visit["title"] or ""
        visit_time = chrome_time_to_unix(visit["visit_time"])
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
                    "source": "chrome",
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
    chrome_conn.close()
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
