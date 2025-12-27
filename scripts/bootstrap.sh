#!/usr/bin/env bash
# Ronald-GI Bootstrap Script
# Sets up the environment and initializes the database

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== Ronald-GI Bootstrap ==="
echo "Project directory: $PROJECT_DIR"

# Detect container runtime
if command -v podman &> /dev/null; then
    RUNTIME="podman"
    COMPOSE="podman-compose"
elif command -v docker &> /dev/null; then
    RUNTIME="docker"
    COMPOSE="docker compose"
else
    echo "Error: Neither podman nor docker found. Please install one."
    exit 1
fi

echo "Using container runtime: $RUNTIME"

# Create data directory
mkdir -p "$PROJECT_DIR/data"

# Initialize SQLite database if it doesn't exist
DB_PATH="$PROJECT_DIR/data/ronald.db"
if [ ! -f "$DB_PATH" ]; then
    echo "Initializing database..."
    sqlite3 "$DB_PATH" < "$PROJECT_DIR/migrations/001_initial_schema.sql"
    echo "Database initialized at $DB_PATH"
else
    echo "Database already exists at $DB_PATH"
fi

# Pull Ollama model if needed
echo "Checking Ollama setup..."
if $RUNTIME ps -a 2>/dev/null | grep -q ronald-ollama; then
    echo "Ollama container exists"
else
    echo "Pulling Ollama image..."
    $RUNTIME pull ollama/ollama:latest
fi

# Build all services
echo "Building services..."
cd "$PROJECT_DIR"
$COMPOSE build

echo ""
echo "=== Bootstrap Complete ==="
echo "Next steps:"
echo "  1. Start services: ./scripts/up.sh"
echo "  2. Pull Ollama model: $RUNTIME exec ronald-ollama ollama pull qwen2.5:7b"
echo "  3. Ingest history: ./scripts/ingest_history.sh"
echo "  4. Open web UI: http://localhost:3000"
