#!/usr/bin/env bash
# Ronald-GI Bookmark Seeding Script
# Seeds bookmarks from browsers and files

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

API_URL="${API_URL:-http://localhost:3001}"
BOOKMARKS_FILE="${1:-}"

echo "=== Ronald-GI Bookmark Seeding ==="
echo "API: $API_URL"

# Create temp directory
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Function to seed from a JSON file
seed_from_file() {
    local file="$1"
    echo "Seeding from file: $file"

    if [ ! -f "$file" ]; then
        echo "File not found: $file"
        return 1
    fi

    # Expect format: [{"url": "...", "title": "...", "tags": [...], "priority": N}, ...]
    python3 << PYTHON
import json
import urllib.request

with open("$file") as f:
    bookmarks = json.load(f)

sources = []
for b in bookmarks:
    sources.append({
        "url": b["url"],
        "title": b.get("title", ""),
        "description": b.get("description", ""),
        "tags_json": json.dumps(b.get("tags", [])),
        "priority": b.get("priority", 0)
    })

if sources:
    req = urllib.request.Request(
        "$API_URL/api/sources/batch",
        data=json.dumps({"sources": sources}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read())
            print(f"Added: {result.get('added', 0)}, Skipped: {result.get('skipped', 0)}")
    except Exception as e:
        print(f"Seeding failed: {e}")
else:
    print("No bookmarks to seed")
PYTHON
}

# Function to extract Safari bookmarks
extract_safari_bookmarks() {
    if [[ "$OSTYPE" != "darwin"* ]]; then
        return
    fi

    SAFARI_BOOKMARKS="$HOME/Library/Safari/Bookmarks.plist"
    if [ ! -f "$SAFARI_BOOKMARKS" ]; then
        echo "Safari bookmarks not found"
        return
    fi

    echo "Extracting Safari bookmarks..."

    # Convert plist to JSON and extract URLs
    python3 << 'PYTHON'
import plistlib
import json
import urllib.request

def extract_urls(item, urls=None):
    if urls is None:
        urls = []

    if isinstance(item, dict):
        if item.get("URLString"):
            urls.append({
                "url": item["URLString"],
                "title": item.get("URIDictionary", {}).get("title", ""),
                "tags_json": "[]",
                "priority": 0
            })
        for child in item.get("Children", []):
            extract_urls(child, urls)

    return urls

with open("$HOME/Library/Safari/Bookmarks.plist", "rb") as f:
    bookmarks = plistlib.load(f)

urls = extract_urls(bookmarks)

if urls:
    req = urllib.request.Request(
        "$API_URL/api/sources/batch",
        data=json.dumps({"sources": urls}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read())
            print(f"Safari bookmarks: Added {result.get('added', 0)}, Skipped {result.get('skipped', 0)}")
    except Exception as e:
        print(f"Safari bookmark seeding failed: {e}")
else:
    print("Safari: no bookmarks found")
PYTHON
}

# Function to extract Chrome bookmarks
extract_chrome_bookmarks() {
    CHROME_BOOKMARKS=""

    if [[ "$OSTYPE" == "darwin"* ]]; then
        CHROME_BOOKMARKS="$HOME/Library/Application Support/Google/Chrome/Default/Bookmarks"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        CHROME_BOOKMARKS="$HOME/.config/google-chrome/Default/Bookmarks"
    fi

    if [ -z "$CHROME_BOOKMARKS" ] || [ ! -f "$CHROME_BOOKMARKS" ]; then
        echo "Chrome bookmarks not found"
        return
    fi

    echo "Extracting Chrome bookmarks..."

    python3 << 'PYTHON'
import json
import urllib.request

def extract_urls(item, urls=None):
    if urls is None:
        urls = []

    if isinstance(item, dict):
        if item.get("type") == "url":
            urls.append({
                "url": item["url"],
                "title": item.get("name", ""),
                "tags_json": "[]",
                "priority": 0
            })
        for child in item.get("children", []):
            extract_urls(child, urls)

    return urls

chrome_path = "$CHROME_BOOKMARKS".replace("$HOME", __import__("os").environ["HOME"])

with open(chrome_path) as f:
    bookmarks = json.load(f)

urls = []
for root in bookmarks.get("roots", {}).values():
    extract_urls(root, urls)

if urls:
    req = urllib.request.Request(
        "$API_URL/api/sources/batch",
        data=json.dumps({"sources": urls}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read())
            print(f"Chrome bookmarks: Added {result.get('added', 0)}, Skipped {result.get('skipped', 0)}")
    except Exception as e:
        print(f"Chrome bookmark seeding failed: {e}")
else:
    print("Chrome: no bookmarks found")
PYTHON
}

# Main logic
if [ -n "$BOOKMARKS_FILE" ]; then
    # Seed from provided file
    seed_from_file "$BOOKMARKS_FILE"
else
    # Extract from browsers
    echo ""
    extract_safari_bookmarks
    echo ""
    extract_chrome_bookmarks
fi

echo ""
echo "=== Seeding Complete ==="
echo "Sources will be processed by the worker."
