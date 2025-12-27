#!/usr/bin/env bash
# Ronald-GI Start Script
# Starts all services

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Detect container runtime
if command -v podman &> /dev/null; then
    RUNTIME="podman"
    COMPOSE="podman-compose"
elif command -v docker &> /dev/null; then
    RUNTIME="docker"
    COMPOSE="docker compose"
else
    echo "Error: Neither podman nor docker found."
    exit 1
fi

echo "=== Starting Ronald-GI ==="

cd "$PROJECT_DIR"

# Ensure data directory exists
mkdir -p "$PROJECT_DIR/data"

# Initialize database if needed
DB_PATH="$PROJECT_DIR/data/ronald.db"
if [ ! -f "$DB_PATH" ]; then
    echo "Initializing database..."
    sqlite3 "$DB_PATH" < "$PROJECT_DIR/migrations/001_initial_schema.sql"
fi

# Start services
if [ "${1:-}" = "-d" ] || [ "${1:-}" = "--detach" ]; then
    $COMPOSE up -d
    echo ""
    echo "Services started in background."
    echo "  Web UI: http://localhost:3000"
    echo "  API:    http://localhost:3001"
    echo "  Ollama: http://localhost:11434"
    echo ""
    echo "View logs: ./scripts/logs.sh"
else
    $COMPOSE up
fi
