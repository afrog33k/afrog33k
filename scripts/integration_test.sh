#!/usr/bin/env bash
# Ronald-GI Integration Tests
# Tests the full system with real API calls

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

API_URL="${API_URL:-http://localhost:3001}"
EMBEDDER_URL="${EMBEDDER_URL:-http://localhost:8000}"
OLLAMA_URL="${OLLAMA_URL:-http://localhost:11434}"

echo "=== Ronald-GI Integration Tests ==="
echo "API: $API_URL"
echo "Embedder: $EMBEDDER_URL"
echo "Ollama: $OLLAMA_URL"
echo ""

PASSED=0
FAILED=0

# Helper function to run a test
run_test() {
    local name="$1"
    local cmd="$2"

    echo -n "Testing: $name... "
    if eval "$cmd" > /dev/null 2>&1; then
        echo "✓"
        PASSED=$((PASSED + 1))
    else
        echo "✗"
        FAILED=$((FAILED + 1))
    fi
}

# Health checks
echo "--- Health Checks ---"
run_test "API health" "curl -sf $API_URL/health"
run_test "Embedder health" "curl -sf $EMBEDDER_URL/health"
run_test "Ollama availability" "curl -sf $OLLAMA_URL/api/tags"
echo ""

# API CRUD operations
echo "--- API CRUD Tests ---"

# Create a source
SOURCE_RESP=$(curl -sf -X POST "$API_URL/api/sources" \
    -H "Content-Type: application/json" \
    -d '{"url": "https://test-integration.example.com", "title": "Integration Test", "priority": 1}' 2>/dev/null || echo '{}')

SOURCE_ID=$(echo "$SOURCE_RESP" | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")

if [ -n "$SOURCE_ID" ]; then
    echo "✓ Create source: $SOURCE_ID"
    PASSED=$((PASSED + 1))
else
    echo "✗ Create source failed"
    FAILED=$((FAILED + 1))
fi

# List sources
run_test "List sources" "curl -sf '$API_URL/api/sources' | grep -q 'sources'"

# Create a report
REPORT_RESP=$(curl -sf -X POST "$API_URL/api/reports" \
    -H "Content-Type: application/json" \
    -d '{
        "type": "research_brief",
        "title": "Integration Test Report",
        "summary": "This is an integration test",
        "impact_score": 0.7,
        "novelty_score": 0.6,
        "relevance_score": 0.5,
        "promoted": 1
    }' 2>/dev/null || echo '{}')

REPORT_ID=$(echo "$REPORT_RESP" | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")

if [ -n "$REPORT_ID" ]; then
    echo "✓ Create report: $REPORT_ID"
    PASSED=$((PASSED + 1))
else
    echo "✗ Create report failed"
    FAILED=$((FAILED + 1))
fi

# Get home reports (3+1 stack)
run_test "Get home reports" "curl -sf '$API_URL/api/reports/home' | grep -q 'top3'"

# Pin the report
if [ -n "$REPORT_ID" ]; then
    run_test "Pin report" "curl -sf -X POST '$API_URL/api/reports/$REPORT_ID/pin'"
fi

# Get report by ID
if [ -n "$REPORT_ID" ]; then
    run_test "Get report by ID" "curl -sf '$API_URL/api/reports/$REPORT_ID' | grep -q 'Integration Test Report'"
fi

# Unpin the report
if [ -n "$REPORT_ID" ]; then
    run_test "Unpin report" "curl -sf -X POST '$API_URL/api/reports/$REPORT_ID/unpin'"
fi

# Create a concept
CONCEPT_RESP=$(curl -sf -X POST "$API_URL/api/concepts" \
    -H "Content-Type: application/json" \
    -d '{"label": "integration-testing", "description": "Testing the integration"}' 2>/dev/null || echo '{}')

CONCEPT_ID=$(echo "$CONCEPT_RESP" | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")

if [ -n "$CONCEPT_ID" ]; then
    echo "✓ Create concept: $CONCEPT_ID"
    PASSED=$((PASSED + 1))
else
    echo "✗ Create concept failed (may already exist)"
fi

# List concepts
run_test "List concepts" "curl -sf '$API_URL/api/concepts' | grep -q 'concepts'"

# Send telemetry
if [ -n "$REPORT_ID" ]; then
    run_test "Send telemetry" "curl -sf -X POST '$API_URL/api/telemetry' \
        -H 'Content-Type: application/json' \
        -d '{\"report_id\": \"$REPORT_ID\", \"event_type\": \"open\"}'"
fi

# Send feedback
if [ -n "$REPORT_ID" ]; then
    run_test "Send feedback" "curl -sf -X POST '$API_URL/api/feedback' \
        -H 'Content-Type: application/json' \
        -d '{\"report_id\": \"$REPORT_ID\", \"action\": \"useful\"}'"
fi

# Get UI actions
run_test "Get UI actions" "curl -sf '$API_URL/api/ui-actions' | grep -q 'actions'"

# Get system stats
run_test "Get system stats" "curl -sf '$API_URL/api/system/stats' | grep -q 'reports'"

# Create a job
run_test "Create job" "curl -sf -X POST '$API_URL/api/jobs' \
    -H 'Content-Type: application/json' \
    -d '{\"job_type\": \"ideation\", \"priority\": 0}'"

# List jobs
run_test "List jobs" "curl -sf '$API_URL/api/jobs' | grep -q 'jobs'"

echo ""

# Embedder tests
echo "--- Embedder Tests ---"

# Single embedding
run_test "Single embedding" "curl -sf -X POST '$EMBEDDER_URL/embed' \
    -H 'Content-Type: application/json' \
    -d '{\"texts\": [\"Hello world\"]}' | grep -q 'embeddings'"

# Multiple embeddings
run_test "Multiple embeddings" "curl -sf -X POST '$EMBEDDER_URL/embed' \
    -H 'Content-Type: application/json' \
    -d '{\"texts\": [\"First\", \"Second\", \"Third\"]}' | grep -q 'embeddings'"

# Similarity search
run_test "Similarity search" "curl -sf -X POST '$EMBEDDER_URL/similarity' \
    -H 'Content-Type: application/json' \
    -d '{\"query\": \"programming\", \"candidates\": [\"python code\", \"cooking\"], \"top_k\": 2}' | grep -q 'results'"

echo ""

# Summary
echo "=== Integration Test Summary ==="
TOTAL=$((PASSED + FAILED))
echo "Passed: $PASSED/$TOTAL"
echo "Failed: $FAILED/$TOTAL"

if [ $FAILED -eq 0 ]; then
    echo ""
    echo "✓ All integration tests passed!"
    exit 0
else
    echo ""
    echo "✗ Some integration tests failed"
    exit 1
fi
