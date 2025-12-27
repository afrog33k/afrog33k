#!/usr/bin/env python3
"""
HackerNews Ingestion for Ronald-GI

Fetches top stories from HN, filters for GitHub repos, and ingests them as sources.
Designed to run hourly via cron.

Usage:
    python scripts/ingest_hackernews.py [--filter github] [--limit 50]
"""

import argparse
import sqlite3
import requests
import hashlib
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse
from typing import Optional, List, Dict, Any

# HN API endpoints
HN_TOP_STORIES = "https://hacker-news.firebaseio.com/v0/topstories.json"
HN_NEW_STORIES = "https://hacker-news.firebaseio.com/v0/newstories.json"
HN_ITEM = "https://hacker-news.firebaseio.com/v0/item/{}.json"
HN_ALGOLIA_SEARCH = "https://hn.algolia.com/api/v1/search"

DB_PATH = Path(__file__).parent.parent / "data" / "ronald.db"


def get_db():
    """Get database connection."""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def generate_id(url: str) -> str:
    """Generate deterministic ID from URL."""
    return hashlib.sha256(url.encode()).hexdigest()[:16]


def fetch_hn_item(item_id: int) -> Optional[Dict[str, Any]]:
    """Fetch a single HN item."""
    try:
        resp = requests.get(HN_ITEM.format(item_id), timeout=10)
        if resp.status_code == 200:
            return resp.json()
    except Exception as e:
        print(f"Error fetching item {item_id}: {e}")
    return None


def search_hn_github(limit: int = 50, time_range: str = "24h") -> List[Dict[str, Any]]:
    """
    Search HN for GitHub links using Algolia API.
    This is what you normally do: filter site=github.com
    """
    results = []
    params = {
        "query": "",
        "tags": "story",
        "numericFilters": f"created_at_i>{int(time.time()) - 86400}",  # Last 24h
        "hitsPerPage": limit,
    }

    try:
        # Search for github.com URLs
        resp = requests.get(
            f"{HN_ALGOLIA_SEARCH}?query=site:github.com",
            params={"tags": "story", "hitsPerPage": limit},
            timeout=15
        )
        if resp.status_code == 200:
            data = resp.json()
            for hit in data.get("hits", []):
                url = hit.get("url", "")
                if "github.com" in url:
                    results.append({
                        "title": hit.get("title", ""),
                        "url": url,
                        "hn_id": hit.get("objectID"),
                        "points": hit.get("points", 0),
                        "num_comments": hit.get("num_comments", 0),
                        "author": hit.get("author", ""),
                        "created_at": hit.get("created_at_i", 0),
                    })
    except Exception as e:
        print(f"Error searching HN: {e}")

    return results


def fetch_top_stories(limit: int = 100) -> List[int]:
    """Fetch top story IDs."""
    try:
        resp = requests.get(HN_TOP_STORIES, timeout=10)
        if resp.status_code == 200:
            return resp.json()[:limit]
    except Exception as e:
        print(f"Error fetching top stories: {e}")
    return []


def extract_github_info(url: str) -> Optional[Dict[str, str]]:
    """Extract owner/repo from GitHub URL."""
    parsed = urlparse(url)
    if "github.com" not in parsed.netloc:
        return None

    parts = parsed.path.strip("/").split("/")
    if len(parts) >= 2:
        return {
            "owner": parts[0],
            "repo": parts[1].replace(".git", ""),
            "full_name": f"{parts[0]}/{parts[1].replace('.git', '')}",
        }
    return None


def ingest_story(conn: sqlite3.Connection, story: Dict[str, Any]) -> bool:
    """Ingest a single story as a source."""
    url = story.get("url", "")
    if not url:
        return False

    source_id = generate_id(url)
    host = urlparse(url).netloc

    # Check if already exists
    existing = conn.execute(
        "SELECT id FROM sources WHERE id = ?", (source_id,)
    ).fetchone()

    if existing:
        # Update priority based on HN score
        points = story.get("points", 0)
        new_priority = min(10, 5 + (points // 100))
        conn.execute(
            "UPDATE sources SET priority = MAX(priority, ?) WHERE id = ?",
            (new_priority, source_id)
        )
        return False

    # Calculate priority based on HN engagement
    points = story.get("points", 0)
    comments = story.get("num_comments", 0)
    priority = min(10, 5 + (points // 50) + (comments // 20))

    # Extract GitHub info if available
    github_info = extract_github_info(url)
    metadata = {
        "hn_id": story.get("hn_id"),
        "hn_points": points,
        "hn_comments": comments,
        "hn_author": story.get("author", ""),
    }
    if github_info:
        metadata["github_owner"] = github_info["owner"]
        metadata["github_repo"] = github_info["repo"]

    # Insert source
    conn.execute("""
        INSERT INTO sources (id, url, title, host, priority, metadata_json, discovered_via)
        VALUES (?, ?, ?, ?, ?, ?, 'hackernews')
    """, (
        source_id,
        url,
        story.get("title", ""),
        host,
        priority,
        str(metadata),
    ))

    # Also create a visit record (simulating discovery)
    visit_id = generate_id(f"hn_{story.get('hn_id', '')}_{url}")
    try:
        conn.execute("""
            INSERT OR IGNORE INTO visits (id, url, title, host, browser, visited_at)
            VALUES (?, ?, ?, ?, 'hackernews', datetime('now'))
        """, (visit_id, url, story.get("title", ""), host))
    except:
        pass

    return True


def create_research_job(conn: sqlite3.Connection, source_id: str, url: str, priority: int):
    """Create a job to research this source."""
    import json
    job_id = generate_id(f"job_{source_id}_{time.time()}")

    conn.execute("""
        INSERT OR IGNORE INTO job_queue (id, job_type, payload_json, priority, status)
        VALUES (?, 'research', ?, ?, 'pending')
    """, (
        job_id,
        json.dumps({"source_id": source_id, "url": url}),
        priority,
    ))


def main():
    parser = argparse.ArgumentParser(description="Ingest HackerNews stories")
    parser.add_argument("--filter", choices=["github", "all"], default="github",
                       help="Filter for GitHub repos only (default) or all")
    parser.add_argument("--limit", type=int, default=50,
                       help="Max stories to fetch (default: 50)")
    parser.add_argument("--create-jobs", action="store_true",
                       help="Create research jobs for new sources")
    parser.add_argument("--dry-run", action="store_true",
                       help="Print what would be ingested without writing")
    args = parser.parse_args()

    print(f"[{datetime.now().isoformat()}] Starting HackerNews ingestion...")
    print(f"  Filter: {args.filter}, Limit: {args.limit}")

    # Fetch stories
    if args.filter == "github":
        print("  Searching for GitHub links on HN...")
        stories = search_hn_github(limit=args.limit)
    else:
        print("  Fetching top stories...")
        story_ids = fetch_top_stories(limit=args.limit)
        stories = []
        for i, sid in enumerate(story_ids):
            item = fetch_hn_item(sid)
            if item and item.get("url"):
                stories.append({
                    "title": item.get("title", ""),
                    "url": item.get("url", ""),
                    "hn_id": sid,
                    "points": item.get("score", 0),
                    "num_comments": item.get("descendants", 0),
                    "author": item.get("by", ""),
                })
            if i % 10 == 0:
                print(f"    Fetched {i}/{len(story_ids)} items...")
            time.sleep(0.1)  # Rate limit

    print(f"  Found {len(stories)} stories")

    if args.dry_run:
        print("\n  [DRY RUN] Would ingest:")
        for s in stories[:10]:
            print(f"    - {s['title'][:60]}... ({s['points']} pts)")
        return

    # Ingest
    conn = get_db()
    new_count = 0

    for story in stories:
        if ingest_story(conn, story):
            new_count += 1
            if args.create_jobs:
                source_id = generate_id(story["url"])
                priority = min(10, 5 + (story.get("points", 0) // 50))
                create_research_job(conn, source_id, story["url"], priority)

    conn.commit()
    conn.close()

    print(f"\n  ✓ Ingested {new_count} new sources")
    print(f"  ✓ Updated {len(stories) - new_count} existing sources")
    if args.create_jobs:
        print(f"  ✓ Created {new_count} research jobs")


if __name__ == "__main__":
    main()
