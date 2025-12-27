#!/usr/bin/env bash
# Ronald-GI Health Check Script
# Checks the health of all services

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== Ronald-GI Health Check ==="
echo ""

# Check each service
check_service() {
    local name=$1
    local url=$2

    if curl -sf "$url" > /dev/null 2>&1; then
        echo "✓ $name: healthy"
        return 0
    else
        echo "✗ $name: unreachable"
        return 1
    fi
}

HEALTHY=0
TOTAL=4

check_service "Ollama" "http://localhost:11434/api/tags" && ((HEALTHY++)) || true
check_service "API" "http://localhost:3001/health" && ((HEALTHY++)) || true
check_service "Web" "http://localhost:3000/api/health" && ((HEALTHY++)) || true
check_service "Embedder" "http://localhost:8000/health" && ((HEALTHY++)) || true

echo ""
echo "=== $HEALTHY/$TOTAL services healthy ==="

# Check database
DB_PATH="$PROJECT_DIR/data/ronald.db"
if [ -f "$DB_PATH" ]; then
    REPORT_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM reports;" 2>/dev/null || echo "0")
    SOURCE_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM sources;" 2>/dev/null || echo "0")
    VISIT_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM visits;" 2>/dev/null || echo "0")
    echo ""
    echo "Database stats:"
    echo "  Reports: $REPORT_COUNT"
    echo "  Sources: $SOURCE_COUNT"
    echo "  Visits:  $VISIT_COUNT"
fi

# Exit with appropriate code
if [ "$HEALTHY" -eq "$TOTAL" ]; then
    exit 0
else
    exit 1
fi
