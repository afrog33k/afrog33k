#!/usr/bin/env python3
"""
Twitter/X Monitoring via xcancel.com for Ronald-GI

Monitors specific Twitter accounts and searches for ML/AI content.
Uses xcancel.com (Nitter instance) to avoid API limits.

Usage:
    python scripts/ingest_xcancel.py --accounts karpathy,ylecun,goodfellow_ian
    python scripts/ingest_xcancel.py --search "machine learning" --limit 50
"""

import argparse
import sqlite3
import hashlib
import re
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse, urljoin, quote
from typing import List, Dict, Any, Optional

try:
    import requests
    from bs4 import BeautifulSoup
    HAS_BS4 = True
except ImportError:
    HAS_BS4 = False
    print("Warning: beautifulsoup4 not installed. Run: pip install beautifulsoup4")

# Nitter/xcancel instances (fallbacks)
NITTER_INSTANCES = [
    "https://xcancel.com",
    "https://nitter.net",
    "https://nitter.it",
]

DB_PATH = Path(__file__).parent.parent / "data" / "ronald.db"

# Default accounts to monitor (ML/AI influencers)
DEFAULT_ACCOUNTS = [
    "karpathy",      # Andrej Karpathy
    "ylecun",        # Yann LeCun
    "goodloer",     # Ian Goodfellow
    "fchollet",      # François Chollet
    "hardmaru",      # David Ha
    "ch402",         # Chris Olah
    "gaborcselle",   # Gabor Cselle
    "swabornikov",   # Sam Altman's account
    "AnthropicAI",   # Anthropic
    "OpenAI",        # OpenAI
]


def get_db():
    """Get database connection."""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def generate_id(text: str) -> str:
    """Generate deterministic ID."""
    return hashlib.sha256(text.encode()).hexdigest()[:16]


def get_working_instance() -> Optional[str]:
    """Find a working Nitter instance."""
    for instance in NITTER_INSTANCES:
        try:
            resp = requests.get(instance, timeout=5)
            if resp.status_code == 200:
                return instance
        except:
            continue
    return None


def fetch_user_tweets(instance: str, username: str, limit: int = 20) -> List[Dict[str, Any]]:
    """Fetch recent tweets from a user."""
    if not HAS_BS4:
        return []

    tweets = []
    try:
        url = f"{instance}/{username}"
        resp = requests.get(url, timeout=15, headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"
        })

        if resp.status_code != 200:
            print(f"    Error fetching @{username}: HTTP {resp.status_code}")
            return []

        soup = BeautifulSoup(resp.text, "html.parser")

        # Find tweet containers (Nitter structure)
        tweet_items = soup.select(".timeline-item, .tweet-body, .main-tweet")

        for item in tweet_items[:limit]:
            # Extract tweet text
            tweet_text_el = item.select_one(".tweet-content, .tweet-text")
            tweet_text = tweet_text_el.get_text(strip=True) if tweet_text_el else ""

            # Extract links
            links = []
            for a in item.select("a"):
                href = a.get("href", "")
                if href and not href.startswith("/") and "http" in href:
                    links.append(href)

            # Extract timestamp
            time_el = item.select_one("time, .tweet-date a")
            timestamp = time_el.get("datetime", "") if time_el else ""

            # Extract tweet ID from link
            tweet_link = item.select_one("a.tweet-link, .tweet-date a")
            tweet_id = ""
            if tweet_link:
                href = tweet_link.get("href", "")
                match = re.search(r"/status/(\d+)", href)
                if match:
                    tweet_id = match.group(1)

            if tweet_text:
                tweets.append({
                    "username": username,
                    "text": tweet_text[:1000],
                    "tweet_id": tweet_id,
                    "links": links,
                    "timestamp": timestamp,
                })

    except Exception as e:
        print(f"    Error parsing @{username}: {e}")

    return tweets


def extract_github_links(links: List[str]) -> List[str]:
    """Filter for GitHub links."""
    return [l for l in links if "github.com" in l]


def ingest_tweet(conn: sqlite3.Connection, tweet: Dict[str, Any]) -> Dict[str, int]:
    """Ingest a tweet and its links as sources."""
    stats = {"tweets": 0, "sources": 0, "github": 0}

    # Create visit record for the tweet itself
    tweet_url = f"https://twitter.com/{tweet['username']}/status/{tweet['tweet_id']}"
    visit_id = generate_id(tweet_url)

    try:
        conn.execute("""
            INSERT OR IGNORE INTO visits (id, url, title, host, browser, visited_at, excerpt)
            VALUES (?, ?, ?, 'twitter.com', 'xcancel', datetime('now'), ?)
        """, (
            visit_id,
            tweet_url,
            f"@{tweet['username']}: {tweet['text'][:100]}",
            tweet['text'][:500],
        ))
        stats["tweets"] = 1
    except:
        pass

    # Ingest GitHub links as high-priority sources
    github_links = extract_github_links(tweet.get("links", []))
    for link in github_links:
        source_id = generate_id(link)
        host = urlparse(link).netloc

        try:
            existing = conn.execute(
                "SELECT id FROM sources WHERE id = ?", (source_id,)
            ).fetchone()

            if not existing:
                conn.execute("""
                    INSERT INTO sources (id, url, title, host, priority, discovered_via, metadata_json)
                    VALUES (?, ?, ?, ?, 8, 'twitter', ?)
                """, (
                    source_id,
                    link,
                    f"Shared by @{tweet['username']}",
                    host,
                    f'{{"twitter_user": "{tweet["username"]}", "tweet_id": "{tweet["tweet_id"]}"}}',
                ))
                stats["sources"] += 1
                stats["github"] += 1
            else:
                # Boost priority if shared by notable accounts
                conn.execute(
                    "UPDATE sources SET priority = MIN(10, priority + 1) WHERE id = ?",
                    (source_id,)
                )
        except Exception as e:
            print(f"      Error ingesting {link}: {e}")

    return stats


def search_tweets(instance: str, query: str, limit: int = 30) -> List[Dict[str, Any]]:
    """Search for tweets matching query."""
    if not HAS_BS4:
        return []

    tweets = []
    try:
        url = f"{instance}/search?q={quote(query)}"
        resp = requests.get(url, timeout=15, headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"
        })

        if resp.status_code != 200:
            return []

        soup = BeautifulSoup(resp.text, "html.parser")
        tweet_items = soup.select(".timeline-item")

        for item in tweet_items[:limit]:
            username_el = item.select_one(".username")
            username = username_el.get_text(strip=True).replace("@", "") if username_el else ""

            tweet_text_el = item.select_one(".tweet-content")
            tweet_text = tweet_text_el.get_text(strip=True) if tweet_text_el else ""

            links = []
            for a in item.select("a"):
                href = a.get("href", "")
                if href and "http" in href and "nitter" not in href:
                    links.append(href)

            tweet_link = item.select_one(".tweet-date a")
            tweet_id = ""
            if tweet_link:
                href = tweet_link.get("href", "")
                match = re.search(r"/status/(\d+)", href)
                if match:
                    tweet_id = match.group(1)

            if tweet_text:
                tweets.append({
                    "username": username,
                    "text": tweet_text[:1000],
                    "tweet_id": tweet_id,
                    "links": links,
                })

    except Exception as e:
        print(f"    Error searching: {e}")

    return tweets


def main():
    parser = argparse.ArgumentParser(description="Monitor Twitter via xcancel/Nitter")
    parser.add_argument("--accounts", type=str, default=",".join(DEFAULT_ACCOUNTS),
                       help="Comma-separated list of accounts to monitor")
    parser.add_argument("--search", type=str, default="",
                       help="Search query (e.g., 'machine learning github')")
    parser.add_argument("--limit", type=int, default=20,
                       help="Max tweets per account/search")
    parser.add_argument("--dry-run", action="store_true",
                       help="Print without writing to database")
    args = parser.parse_args()

    print(f"[{datetime.now().isoformat()}] Starting Twitter/xcancel ingestion...")

    # Find working instance
    instance = get_working_instance()
    if not instance:
        print("  ✗ No working Nitter instance found")
        return

    print(f"  Using instance: {instance}")

    if not HAS_BS4:
        print("  ✗ beautifulsoup4 required. Install with: pip install beautifulsoup4")
        return

    all_tweets = []

    # Fetch from accounts
    accounts = [a.strip() for a in args.accounts.split(",") if a.strip()]
    if accounts:
        print(f"  Monitoring {len(accounts)} accounts...")
        for account in accounts:
            print(f"    Fetching @{account}...")
            tweets = fetch_user_tweets(instance, account, limit=args.limit)
            all_tweets.extend(tweets)
            time.sleep(1)  # Rate limit

    # Search if query provided
    if args.search:
        print(f"  Searching for: {args.search}")
        search_results = search_tweets(instance, args.search, limit=args.limit)
        all_tweets.extend(search_results)

    print(f"  Found {len(all_tweets)} tweets")

    if args.dry_run:
        print("\n  [DRY RUN] Would ingest:")
        for t in all_tweets[:10]:
            github_count = len(extract_github_links(t.get("links", [])))
            print(f"    @{t['username']}: {t['text'][:50]}... ({github_count} GitHub links)")
        return

    # Ingest
    conn = get_db()
    total_stats = {"tweets": 0, "sources": 0, "github": 0}

    for tweet in all_tweets:
        stats = ingest_tweet(conn, tweet)
        for k, v in stats.items():
            total_stats[k] += v

    conn.commit()
    conn.close()

    print(f"\n  ✓ Processed {total_stats['tweets']} tweets")
    print(f"  ✓ Ingested {total_stats['sources']} new sources")
    print(f"  ✓ Found {total_stats['github']} GitHub links")


if __name__ == "__main__":
    main()
