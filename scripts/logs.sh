#!/usr/bin/env bash
# Ronald-GI Logs Script
# View service logs

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

cd "$PROJECT_DIR"

# Show logs for specific service or all
SERVICE="${1:-}"
FOLLOW="${2:-}"

if [ -n "$SERVICE" ] && [ "$SERVICE" != "-f" ]; then
    if [ "$FOLLOW" = "-f" ] || [ "$SERVICE" = "-f" ]; then
        $COMPOSE logs -f "$SERVICE"
    else
        $COMPOSE logs "$SERVICE"
    fi
elif [ "$SERVICE" = "-f" ]; then
    $COMPOSE logs -f
else
    $COMPOSE logs
fi
