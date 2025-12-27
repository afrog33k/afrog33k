#!/usr/bin/env python3
"""
Seed bookmarks from browser bookmark files as sources for Ronald-GI
Supports Safari, Chrome, and Firefox bookmark formats.
"""

import json
import sqlite3
import os
import platform
import plistlib
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse
from typing import List, Dict, Any

# Configuration
DB_PATH = os.environ.get("DATABASE_PATH", "/worktrees/afrog33k/dexter/data/ronald.db")

# Hosts to exclude (navigation/utility sites)
EXCLUDE_HOSTS = {
    "localhost",
    "127.0.0.1",
    "google.com",
    "www.google.com",
    "accounts.google.com",
    "www.youtube.com",
    "youtube.com",
    "facebook.com",
    "www.facebook.com",
    "twitter.com",
    "x.com",
    "instagram.com",
    "www.instagram.com",
    "amazon.com",
    "www.amazon.com",
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
    if "localhost" in host or "127.0.0.1" in host:
        return False
    return True


def get_safari_bookmarks_path() -> str:
    """Get Safari bookmarks path (macOS only)."""
    return os.path.expanduser("~/Library/Safari/Bookmarks.plist")


def get_chrome_bookmarks_path() -> str:
    """Get Chrome bookmarks path for current OS."""
    system = platform.system()
    if system == "Darwin":
        return os.path.expanduser("~/Library/Application Support/Google/Chrome/Default/Bookmarks")
    elif system == "Linux":
        return os.path.expanduser("~/.config/google-chrome/Default/Bookmarks")
    elif system == "Windows":
        return os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\User Data\Default\Bookmarks")
    return ""


def get_firefox_bookmarks_path() -> str:
    """Get Firefox bookmarks path (stored in places.sqlite)."""
    system = platform.system()
    if system == "Darwin":
        profiles_dir = os.path.expanduser("~/Library/Application Support/Firefox/Profiles")
    elif system == "Linux":
        profiles_dir = os.path.expanduser("~/.mozilla/firefox")
    elif system == "Windows":
        profiles_dir = os.path.expandvars(r"%APPDATA%\Mozilla\Firefox\Profiles")
    else:
        return ""

    # Find default profile
    if os.path.exists(profiles_dir):
        for entry in os.listdir(profiles_dir):
            if entry.endswith(".default") or entry.endswith(".default-release"):
                return os.path.join(profiles_dir, entry, "places.sqlite")
    return ""


def parse_safari_bookmarks(path: str) -> List[Dict[str, Any]]:
    """Parse Safari bookmarks from plist file."""
    bookmarks = []

    if not os.path.exists(path):
        return bookmarks

    try:
        with open(path, "rb") as f:
            plist = plistlib.load(f)

        def traverse(node, folder_path=""):
            if not isinstance(node, dict):
                return

            if node.get("WebBookmarkType") == "WebBookmarkTypeLeaf":
                url = node.get("URLString", "")
                title = node.get("URIDictionary", {}).get("title", "")
                if url:
                    bookmarks.append({
                        "url": url,
                        "title": title or url,
                        "folder": folder_path,
                        "source": "safari"
                    })
            elif node.get("WebBookmarkType") == "WebBookmarkTypeList":
                folder_name = node.get("Title", "")
                new_path = f"{folder_path}/{folder_name}" if folder_path else folder_name
                for child in node.get("Children", []):
                    traverse(child, new_path)

        traverse(plist)
    except Exception as e:
        print(f"Error parsing Safari bookmarks: {e}")

    return bookmarks


def parse_chrome_bookmarks(path: str) -> List[Dict[str, Any]]:
    """Parse Chrome bookmarks from JSON file."""
    bookmarks = []

    if not os.path.exists(path):
        return bookmarks

    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)

        def traverse(node, folder_path=""):
            if not isinstance(node, dict):
                return

            node_type = node.get("type")
            name = node.get("name", "")

            if node_type == "url":
                url = node.get("url", "")
                if url:
                    bookmarks.append({
                        "url": url,
                        "title": name or url,
                        "folder": folder_path,
                        "source": "chrome"
                    })
            elif node_type == "folder":
                new_path = f"{folder_path}/{name}" if folder_path else name
                for child in node.get("children", []):
                    traverse(child, new_path)

        roots = data.get("roots", {})
        for root_name, root_node in roots.items():
            if isinstance(root_node, dict):
                traverse(root_node, root_name)
    except Exception as e:
        print(f"Error parsing Chrome bookmarks: {e}")

    return bookmarks


def parse_firefox_bookmarks(path: str) -> List[Dict[str, Any]]:
    """Parse Firefox bookmarks from places.sqlite."""
    bookmarks = []

    if not os.path.exists(path):
        return bookmarks

    try:
        # Firefox locks its database, so we need to copy it
        import shutil
        import tempfile

        temp_dir = tempfile.mkdtemp()
        temp_db = os.path.join(temp_dir, "places.sqlite")
        shutil.copy2(path, temp_db)

        conn = sqlite3.connect(temp_db)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        cursor.execute("""
            SELECT
                p.url,
                b.title,
                parent.title as folder
            FROM moz_bookmarks b
            JOIN moz_places p ON b.fk = p.id
            LEFT JOIN moz_bookmarks parent ON b.parent = parent.id
            WHERE b.type = 1 AND p.url LIKE 'http%'
        """)

        for row in cursor.fetchall():
            bookmarks.append({
                "url": row["url"],
                "title": row["title"] or row["url"],
                "folder": row["folder"] or "",
                "source": "firefox"
            })

        conn.close()
        shutil.rmtree(temp_dir)
    except Exception as e:
        print(f"Error parsing Firefox bookmarks: {e}")

    return bookmarks


def main():
    print(f"=== Seeding Bookmarks ===")
    print(f"Database: {DB_PATH}")
    print()

    all_bookmarks = []

    # Try Safari
    safari_path = get_safari_bookmarks_path()
    if os.path.exists(safari_path):
        print(f"Found Safari bookmarks at {safari_path}")
        safari_bookmarks = parse_safari_bookmarks(safari_path)
        print(f"  Parsed {len(safari_bookmarks)} bookmarks")
        all_bookmarks.extend(safari_bookmarks)
    else:
        print(f"Safari bookmarks not found")

    # Try Chrome
    chrome_path = get_chrome_bookmarks_path()
    if chrome_path and os.path.exists(chrome_path):
        print(f"Found Chrome bookmarks at {chrome_path}")
        chrome_bookmarks = parse_chrome_bookmarks(chrome_path)
        print(f"  Parsed {len(chrome_bookmarks)} bookmarks")
        all_bookmarks.extend(chrome_bookmarks)
    else:
        print(f"Chrome bookmarks not found")

    # Try Firefox
    firefox_path = get_firefox_bookmarks_path()
    if firefox_path and os.path.exists(firefox_path):
        print(f"Found Firefox bookmarks at {firefox_path}")
        firefox_bookmarks = parse_firefox_bookmarks(firefox_path)
        print(f"  Parsed {len(firefox_bookmarks)} bookmarks")
        all_bookmarks.extend(firefox_bookmarks)
    else:
        print(f"Firefox bookmarks not found")

    print()
    print(f"Total bookmarks found: {len(all_bookmarks)}")
    print()

    if not all_bookmarks:
        print("No bookmarks to import")
        return

    # Connect to Ronald DB
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    sources_added = 0
    skipped = 0

    for bookmark in all_bookmarks:
        url = bookmark["url"]
        title = bookmark["title"]
        folder = bookmark["folder"]
        source = bookmark["source"]

        host = extract_host(url)

        if not should_include(url, host):
            skipped += 1
            continue

        # Check if source already exists
        cursor.execute("SELECT id FROM sources WHERE url = ?", (url,))
        if cursor.fetchone():
            skipped += 1
            continue

        # Insert as source
        source_id = uid()
        tags = [source, "bookmark"]
        if folder:
            tags.append(folder.split("/")[-1].lower().replace(" ", "-"))

        try:
            cursor.execute("""
                INSERT INTO sources (id, url, title, host, tags_json, priority)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (
                source_id,
                url[:2000],
                title[:500],
                host,
                json.dumps(tags),
                3  # Medium priority for bookmarks
            ))
            sources_added += 1

            if sources_added % 50 == 0:
                print(f"  Added {sources_added} sources...")
                conn.commit()
        except Exception as e:
            print(f"  Error adding source: {e}")
            continue

    conn.commit()

    print()
    print("=== Seeding Complete ===")
    print(f"Sources added: {sources_added}")
    print(f"Skipped: {skipped}")

    # Show stats
    cursor.execute("SELECT COUNT(*) FROM sources")
    print(f"Total sources: {cursor.fetchone()[0]}")

    cursor.execute("""
        SELECT host, COUNT(*) as cnt
        FROM sources
        GROUP BY host
        ORDER BY cnt DESC
        LIMIT 10
    """)
    print("\nTop 10 hosts:")
    for row in cursor.fetchall():
        print(f"  {row[1]:4d}  {row[0]}")

    conn.close()


if __name__ == "__main__":
    main()
