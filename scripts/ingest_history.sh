#!/usr/bin/env bash
# Ronald-GI History Ingestion Script
# Ingests Safari and Chrome browsing history

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

API_URL="${API_URL:-http://localhost:3001}"
DAYS_BACK="${DAYS_BACK:-7}"

echo "=== Ronald-GI History Ingestion ==="
echo "API: $API_URL"
echo "Days back: $DAYS_BACK"

# Create temp directory for exports
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Function to ingest Safari history (macOS only)
ingest_safari() {
    if [[ "$OSTYPE" != "darwin"* ]]; then
        echo "Safari ingestion only available on macOS"
        return
    fi

    SAFARI_DB="$HOME/Library/Safari/History.db"
    if [ ! -f "$SAFARI_DB" ]; then
        echo "Safari history not found at $SAFARI_DB"
        return
    fi

    echo "Extracting Safari history..."

    # Copy database (Safari locks it)
    cp "$SAFARI_DB" "$TEMP_DIR/safari_history.db"

    # Extract visits from last N days
    sqlite3 -json "$TEMP_DIR/safari_history.db" <<EOF > "$TEMP_DIR/safari_visits.json"
SELECT
    hi.url,
    hv.title,
    datetime(hv.visit_time + 978307200, 'unixepoch', 'localtime') as visited_at
FROM history_visits hv
JOIN history_items hi ON hi.id = hv.history_item
WHERE hv.visit_time > (strftime('%s', 'now', '-$DAYS_BACK days') - 978307200)
ORDER BY hv.visit_time DESC
LIMIT 5000;
EOF

    # Convert to API format and send
    python3 << 'PYTHON'
import json
import sys
import urllib.request

with open("$TEMP_DIR/safari_visits.json") as f:
    visits = json.load(f)

formatted = []
for v in visits:
    formatted.append({
        "url": v["url"],
        "title": v.get("title", ""),
        "browser": "safari",
        "visited_at": v["visited_at"]
    })

if formatted:
    req = urllib.request.Request(
        "$API_URL/api/visits/batch",
        data=json.dumps({"visits": formatted}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read())
            print(f"Safari: ingested {result.get('added', 0)} visits")
    except Exception as e:
        print(f"Safari ingestion failed: {e}")
else:
    print("Safari: no visits to ingest")
PYTHON
}

# Function to ingest Chrome history
ingest_chrome() {
    CHROME_DB=""

    if [[ "$OSTYPE" == "darwin"* ]]; then
        CHROME_DB="$HOME/Library/Application Support/Google/Chrome/Default/History"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        CHROME_DB="$HOME/.config/google-chrome/Default/History"
    fi

    if [ -z "$CHROME_DB" ] || [ ! -f "$CHROME_DB" ]; then
        echo "Chrome history not found"
        return
    fi

    echo "Extracting Chrome history..."

    # Copy database (Chrome locks it)
    cp "$CHROME_DB" "$TEMP_DIR/chrome_history.db"

    # Extract visits from last N days
    sqlite3 -json "$TEMP_DIR/chrome_history.db" <<EOF > "$TEMP_DIR/chrome_visits.json"
SELECT
    urls.url,
    urls.title,
    datetime(visits.visit_time/1000000 - 11644473600, 'unixepoch', 'localtime') as visited_at,
    visits.visit_duration/1000000 as duration_seconds
FROM visits
JOIN urls ON urls.id = visits.url
WHERE visits.visit_time > ((strftime('%s', 'now', '-$DAYS_BACK days') + 11644473600) * 1000000)
ORDER BY visits.visit_time DESC
LIMIT 5000;
EOF

    # Convert to API format and send
    python3 << 'PYTHON'
import json
import urllib.request

with open("$TEMP_DIR/chrome_visits.json") as f:
    visits = json.load(f)

formatted = []
for v in visits:
    formatted.append({
        "url": v["url"],
        "title": v.get("title", ""),
        "browser": "chrome",
        "visited_at": v["visited_at"],
        "duration_seconds": v.get("duration_seconds")
    })

if formatted:
    req = urllib.request.Request(
        "$API_URL/api/visits/batch",
        data=json.dumps({"visits": formatted}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read())
            print(f"Chrome: ingested {result.get('added', 0)} visits")
    except Exception as e:
        print(f"Chrome ingestion failed: {e}")
else:
    print("Chrome: no visits to ingest")
PYTHON
}

# Run ingestion
echo ""
ingest_safari
echo ""
ingest_chrome

echo ""
echo "=== Ingestion Complete ==="

# Trigger clustering job
echo "Triggering clustering job..."
curl -s -X POST "$API_URL/api/jobs" \
    -H "Content-Type: application/json" \
    -d '{"job_type": "ideation", "priority": 1}' > /dev/null || true

echo "Done. New visits will be clustered and processed by the worker."
