#!/usr/bin/env python3
"""
Ingest Safari Reading List for Ronald-GI

Reading List items are high-signal - you explicitly saved them to read later.
These get priority 9 (very high).

Usage:
    python scripts/ingest_reading_list.py
"""

import sqlite3
import plistlib
import os
import json
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse
import hashlib

DB_PATH = Path(__file__).parent.parent / "data" / "ronald.db"
BOOKMARKS_PATH = os.path.expanduser("~/Library/Safari/Bookmarks.plist")


def get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def generate_id(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:16]


def extract_reading_list(plist_path: str) -> list:
    """Extract Reading List items from Safari Bookmarks.plist"""
    items = []

    try:
        with open(plist_path, 'rb') as f:
            bookmarks = plistlib.load(f)

        # Find Reading List folder
        def find_reading_list(node):
            if isinstance(node, dict):
                title = node.get('Title', '')
                if title == 'com.apple.ReadingList':
                    return node.get('Children', [])
                for child in node.get('Children', []):
                    result = find_reading_list(child)
                    if result:
                        return result
            return None

        reading_list = find_reading_list(bookmarks)
        if not reading_list:
            print("Reading List folder not found")
            return items

        for item in reading_list:
            url_dict = item.get('URLString') or item.get('URIDictionary', {}).get('title', '')
            url = item.get('URLString', '')

            if not url:
                continue

            # Extract metadata
            reading_list_data = item.get('ReadingList', {})

            items.append({
                'url': url,
                'title': item.get('URIDictionary', {}).get('title', '') or reading_list_data.get('PreviewText', '')[:100],
                'preview': reading_list_data.get('PreviewText', ''),
                'date_added': reading_list_data.get('DateAdded'),
                'date_last_fetched': reading_list_data.get('DateLastFetched'),
                'is_read': reading_list_data.get('DidFinishReading', False),
            })

    except Exception as e:
        print(f"Error reading bookmarks: {e}")

    return items


def main():
    print(f"[{datetime.now().isoformat()}] Ingesting Safari Reading List...")

    if not os.path.exists(BOOKMARKS_PATH):
        print(f"  Safari bookmarks not found at {BOOKMARKS_PATH}")
        print("  This script requires macOS with Safari.")
        return

    items = extract_reading_list(BOOKMARKS_PATH)
    print(f"  Found {len(items)} Reading List items")

    conn = get_db()
    added = 0
    updated = 0

    for item in items:
        url = item['url']
        source_id = generate_id(url)
        host = urlparse(url).netloc

        # Check if exists
        existing = conn.execute(
            "SELECT id, priority FROM sources WHERE id = ?", (source_id,)
        ).fetchone()

        if existing:
            # Boost priority if from Reading List
            if existing['priority'] < 9:
                conn.execute(
                    "UPDATE sources SET priority = 9, discovered_via = 'reading_list' WHERE id = ?",
                    (source_id,)
                )
                updated += 1
            continue

        # Insert as high-priority source
        metadata = {
            'source': 'reading_list',
            'preview': item.get('preview', '')[:500],
            'is_read': item.get('is_read', False),
        }

        conn.execute("""
            INSERT INTO sources (id, url, title, host, priority, discovered_via, metadata_json)
            VALUES (?, ?, ?, ?, 9, 'reading_list', ?)
        """, (
            source_id,
            url,
            item.get('title', '')[:500],
            host,
            json.dumps(metadata),
        ))

        # Also create a visit record
        visit_id = generate_id(f"rl_{url}")
        try:
            conn.execute("""
                INSERT OR IGNORE INTO visits (id, url, title, host, browser, visited_at)
                VALUES (?, ?, ?, ?, 'reading_list', datetime('now'))
            """, (visit_id, url, item.get('title', ''), host))
        except:
            pass

        added += 1

    conn.commit()
    conn.close()

    print(f"\n  ✓ Added {added} new sources")
    print(f"  ✓ Updated {updated} existing sources to priority 9")


if __name__ == "__main__":
    main()
