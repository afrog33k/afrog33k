#!/usr/bin/env bash
# Ronald-GI Build Script
# Builds all container images

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

echo "=== Building Ronald-GI Services ==="

cd "$PROJECT_DIR"

# Build with optional --no-cache flag
if [ "${1:-}" = "--no-cache" ]; then
    echo "Building without cache..."
    $COMPOSE build --no-cache
else
    $COMPOSE build
fi

echo "=== Build Complete ==="
