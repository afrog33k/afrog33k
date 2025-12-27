#!/usr/bin/env bash
# Ronald-GI Test Runner
# Runs all tests across services

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== Ronald-GI Test Suite ==="
echo ""

# Parse arguments
RUN_UNIT=true
RUN_INTEGRATION=false
RUN_E2E=false
VERBOSE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --unit)
            RUN_UNIT=true
            shift
            ;;
        --integration)
            RUN_INTEGRATION=true
            shift
            ;;
        --e2e)
            RUN_E2E=true
            shift
            ;;
        --all)
            RUN_UNIT=true
            RUN_INTEGRATION=true
            RUN_E2E=true
            shift
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--unit] [--integration] [--e2e] [--all] [-v]"
            exit 1
            ;;
    esac
done

FAILED=0

# Unit tests
if [ "$RUN_UNIT" = true ]; then
    echo "=== Unit Tests ==="
    echo ""

    # API tests
    echo "--- API Service (Vitest) ---"
    if cd "$PROJECT_DIR/services/api" && npm test 2>&1; then
        echo "✓ API tests passed"
    else
        echo "✗ API tests failed"
        FAILED=$((FAILED + 1))
    fi
    echo ""

    # Embedder tests
    echo "--- Embedder Service (pytest) ---"
    if cd "$PROJECT_DIR/services/embedder" && python -m pytest tests/ 2>&1; then
        echo "✓ Embedder tests passed"
    else
        echo "✗ Embedder tests failed"
        FAILED=$((FAILED + 1))
    fi
    echo ""

    # Worker tests
    echo "--- Worker Service (pytest) ---"
    if cd "$PROJECT_DIR/services/worker" && python -m pytest tests/ 2>&1; then
        echo "✓ Worker tests passed"
    else
        echo "✗ Worker tests failed"
        FAILED=$((FAILED + 1))
    fi
    echo ""

    # Web unit tests
    echo "--- Web Service (Vitest) ---"
    if cd "$PROJECT_DIR/services/web" && npm test 2>&1; then
        echo "✓ Web unit tests passed"
    else
        echo "✗ Web unit tests failed"
        FAILED=$((FAILED + 1))
    fi
    echo ""
fi

# Integration tests
if [ "$RUN_INTEGRATION" = true ]; then
    echo "=== Integration Tests ==="
    echo ""

    # Check if services are running
    if ! curl -sf http://localhost:3001/health > /dev/null 2>&1; then
        echo "⚠ API service not running. Start with ./scripts/up.sh -d"
        echo "Skipping integration tests."
    else
        echo "--- API Integration Tests ---"
        cd "$PROJECT_DIR"
        ./scripts/integration_test.sh
    fi
    echo ""
fi

# E2E tests
if [ "$RUN_E2E" = true ]; then
    echo "=== E2E Tests (Playwright) ==="
    echo ""

    if cd "$PROJECT_DIR/services/web" && npm run test:e2e 2>&1; then
        echo "✓ E2E tests passed"
    else
        echo "✗ E2E tests failed"
        FAILED=$((FAILED + 1))
    fi
    echo ""
fi

# Summary
echo "=== Test Summary ==="
if [ $FAILED -eq 0 ]; then
    echo "✓ All tests passed!"
    exit 0
else
    echo "✗ $FAILED test suite(s) failed"
    exit 1
fi
