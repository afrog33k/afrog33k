#!/usr/bin/env bash
# Ronald-GI Stop Script
# Stops all services

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Detect container runtime
if command -v podman &> /dev/null; then
    COMPOSE="podman-compose"
elif command -v docker &> /dev/null; then
    COMPOSE="docker compose"
else
    echo "Error: Neither podman nor docker found."
    exit 1
fi

echo "=== Stopping Ronald-GI ==="

cd "$PROJECT_DIR"

# Stop and optionally remove volumes
if [ "${1:-}" = "--volumes" ] || [ "${1:-}" = "-v" ]; then
    echo "Stopping services and removing volumes..."
    $COMPOSE down -v
else
    $COMPOSE down
fi

echo "=== Services Stopped ==="
