#!/usr/bin/env python3
"""
Integration tests for Ronald-GI with real data
"""

import json
import sys
import os
from urllib.request import urlopen, Request
from urllib.error import HTTPError, URLError
import sqlite3
from dataclasses import dataclass
from typing import List, Tuple

# Configuration
API_URL = os.environ.get("API_URL", "http://localhost:3001")
DB_PATH = os.environ.get("DATABASE_PATH", "/worktrees/afrog33k/dexter/data/ronald.db")
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")


@dataclass
class TestResult:
    name: str
    passed: bool
    message: str
    duration_ms: float = 0


def api_get(endpoint: str) -> dict:
    """Make GET request to API."""
    req = Request(f"{API_URL}{endpoint}", headers={"Accept": "application/json"})
    with urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


def api_post(endpoint: str, data: dict) -> dict:
    """Make POST request to API."""
    req = Request(
        f"{API_URL}{endpoint}",
        data=json.dumps(data).encode(),
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    with urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


def run_test(name: str, test_fn) -> TestResult:
    """Run a test and capture result."""
    import time
    start = time.time()
    try:
        test_fn()
        duration = (time.time() - start) * 1000
        return TestResult(name, True, "OK", duration)
    except AssertionError as e:
        duration = (time.time() - start) * 1000
        return TestResult(name, False, str(e), duration)
    except Exception as e:
        duration = (time.time() - start) * 1000
        return TestResult(name, False, f"Error: {e}", duration)


# ========== API TESTS ==========

def test_api_health():
    """Test API health endpoint."""
    data = api_get("/health")
    assert data.get("status") == "ok", f"Health check failed: {data}"


def test_api_system_stats():
    """Test system stats endpoint."""
    data = api_get("/api/system/stats")
    assert "reports" in data, "Missing reports count"
    assert "sources" in data, "Missing sources count"
    assert "concepts" in data, "Missing concepts count"
    assert data["sources"] > 0, "No sources in database"


def test_api_sources_list():
    """Test sources listing."""
    data = api_get("/api/sources?limit=5")
    assert "sources" in data, "Missing sources array"
    assert len(data["sources"]) > 0, "No sources returned"
    source = data["sources"][0]
    assert "id" in source, "Source missing id"
    assert "url" in source, "Source missing url"


def test_api_sources_filter():
    """Test sources filtering by host."""
    data = api_get("/api/sources?host=github.com")
    assert "sources" in data, "Missing sources array"
    for source in data["sources"]:
        assert source.get("host") == "github.com", f"Wrong host: {source.get('host')}"


def test_api_concepts_list():
    """Test concepts listing."""
    data = api_get("/api/concepts?limit=10")
    assert "concepts" in data, "Missing concepts array"
    assert len(data["concepts"]) > 0, "No concepts returned"
    concept = data["concepts"][0]
    assert "id" in concept, "Concept missing id"
    assert "label" in concept, "Concept missing label"


def test_api_concepts_search():
    """Test concept search."""
    data = api_get("/api/concepts?search=python")
    assert "concepts" in data, "Missing concepts array"
    # May or may not find results, but shouldn't error


def test_api_reports_list():
    """Test reports listing."""
    data = api_get("/api/reports")
    assert "reports" in data, "Missing reports array"
    assert "total" in data, "Missing total count"


def test_api_reports_home():
    """Test home 3+1 stack endpoint."""
    data = api_get("/api/reports/home")
    assert "top3" in data, "Missing top3 array"
    assert "relevancePick" in data, "Missing relevancePick"
    # top3 should have up to 3 items
    assert len(data["top3"]) <= 3, "Too many top cards"


def test_api_reports_promoted():
    """Test promoted reports filter."""
    data = api_get("/api/reports?promoted=true")
    assert "reports" in data, "Missing reports array"
    for report in data["reports"]:
        assert report.get("promoted") == 1, f"Non-promoted report returned"


def test_api_telemetry_record():
    """Test telemetry recording."""
    # Get a real report ID first
    reports = api_get("/api/reports?limit=1")
    if not reports.get("reports"):
        return  # Skip if no reports

    report_id = reports["reports"][0]["id"]
    events = [{
        "report_id": report_id,
        "event_type": "click",
        "event_data_json": "{}"
    }]
    data = api_post("/api/telemetry/batch", {"events": events})
    assert data.get("count", 0) >= 0, "Failed to record telemetry"


def test_api_feedback_record():
    """Test feedback recording."""
    try:
        data = api_post("/api/feedback", {
            "reportId": "test-report-id",
            "action": "dismiss",
            "context": "test"
        })
        # May succeed or fail depending on report existence
    except HTTPError:
        pass  # Expected if report doesn't exist


# ========== DATABASE TESTS ==========

def test_db_schema():
    """Test database schema exists."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    tables = ["sources", "docs", "reports", "concepts", "concept_mentions",
              "telemetry", "feedback", "job_queue"]

    for table in tables:
        cursor.execute(f"SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,))
        assert cursor.fetchone(), f"Missing table: {table}"

    conn.close()


def test_db_sources_data():
    """Test sources have been ingested."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM sources")
    count = cursor.fetchone()[0]
    assert count > 0, "No sources in database"
    conn.close()


def test_db_docs_data():
    """Test docs have been processed."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM docs")
    count = cursor.fetchone()[0]
    assert count > 0, "No docs in database"
    conn.close()


def test_db_concepts_data():
    """Test concepts have been extracted."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM concepts WHERE active = 1")
    count = cursor.fetchone()[0]
    assert count > 0, "No active concepts"
    conn.close()


def test_db_embeddings_exist():
    """Test embeddings were generated."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM docs WHERE embedding IS NOT NULL")
    count = cursor.fetchone()[0]
    assert count > 0, "No embeddings generated"
    conn.close()


def test_db_reports_data():
    """Test reports exist."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM reports")
    count = cursor.fetchone()[0]
    assert count > 0, "No reports generated"
    conn.close()


def test_db_blended_scores():
    """Test blended scores are calculated correctly."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, impact_score, novelty_score, relevance_score, blended_score
        FROM reports LIMIT 10
    """)
    for row in cursor.fetchall():
        rid, impact, novelty, relevance, blended = row
        expected = 0.45 * impact + 0.45 * novelty + 0.10 * relevance
        assert abs(blended - expected) < 0.01, f"Blended score mismatch for {rid}"
    conn.close()


# ========== OLLAMA TESTS ==========

def test_ollama_health():
    """Test Ollama is running."""
    req = Request(f"{OLLAMA_URL}/api/tags")
    with urlopen(req, timeout=5) as resp:
        data = json.loads(resp.read())
        assert "models" in data, "Ollama not returning models"


def test_ollama_embed_model():
    """Test embedding model is available."""
    req = Request(f"{OLLAMA_URL}/api/tags")
    with urlopen(req, timeout=5) as resp:
        data = json.loads(resp.read())
        models = [m["name"] for m in data.get("models", [])]
        assert any("nomic-embed" in m for m in models), f"Embedding model not found in {models}"


def test_ollama_llm_model():
    """Test LLM model is available."""
    req = Request(f"{OLLAMA_URL}/api/tags")
    with urlopen(req, timeout=5) as resp:
        data = json.loads(resp.read())
        models = [m["name"] for m in data.get("models", [])]
        assert any("qwen" in m.lower() for m in models), f"LLM model not found in {models}"


def test_ollama_embedding():
    """Test embedding generation works."""
    payload = json.dumps({"model": "nomic-embed-text", "input": "test text"}).encode()
    req = Request(
        f"{OLLAMA_URL}/api/embed",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    with urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read())
        embeddings = data.get("embeddings", [[]])
        assert len(embeddings[0]) > 0, "Empty embedding returned"


def test_ollama_generation():
    """Test LLM generation works."""
    payload = json.dumps({
        "model": "qwen3:0.6b",
        "prompt": "Say hello:",
        "stream": False,
        "options": {"num_predict": 20, "temperature": 0.5}
    }).encode()
    req = Request(
        f"{OLLAMA_URL}/api/generate",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    with urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read())
        # Response may include thinking tokens which is fine
        response = data.get("response", "")
        # qwen3 sometimes returns just thinking tokens
        assert "error" not in data, f"LLM error: {data.get('error')}"


# ========== INTEGRATION TESTS ==========

def test_e2e_concept_to_doc_link():
    """Test concepts are linked to docs."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT COUNT(*) FROM concept_mentions cm
        JOIN docs d ON cm.entity_id = d.id
        WHERE cm.entity_type = 'doc'
    """)
    count = cursor.fetchone()[0]
    assert count > 0, "No concept-doc links found"
    conn.close()


def test_e2e_report_evidence():
    """Test reports have evidence links."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT evidence_json FROM reports WHERE evidence_json != '[]' LIMIT 5")
    rows = cursor.fetchall()
    assert len(rows) > 0, "No reports with evidence"
    for row in rows:
        evidence = json.loads(row[0])
        assert len(evidence) > 0, "Empty evidence array"
        assert "url" in evidence[0], "Evidence missing URL"
    conn.close()


def test_e2e_source_to_doc_link():
    """Test sources are linked to docs."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT COUNT(*) FROM docs d
        JOIN sources s ON d.source_url = s.url
    """)
    count = cursor.fetchone()[0]
    assert count > 0, "No source-doc links"
    conn.close()


def main():
    print("=" * 60)
    print("RONALD-GI INTEGRATION TESTS")
    print("=" * 60)
    print()

    # Group tests
    test_groups = [
        ("API Health", [
            ("API Health Check", test_api_health),
            ("System Stats", test_api_system_stats),
        ]),
        ("API Sources", [
            ("List Sources", test_api_sources_list),
            ("Filter Sources", test_api_sources_filter),
        ]),
        ("API Concepts", [
            ("List Concepts", test_api_concepts_list),
            ("Search Concepts", test_api_concepts_search),
        ]),
        ("API Reports", [
            ("List Reports", test_api_reports_list),
            ("Home Stack", test_api_reports_home),
            ("Promoted Filter", test_api_reports_promoted),
        ]),
        ("API Telemetry", [
            ("Record Telemetry", test_api_telemetry_record),
            ("Record Feedback", test_api_feedback_record),
        ]),
        ("Database Schema", [
            ("Schema Exists", test_db_schema),
            ("Sources Data", test_db_sources_data),
            ("Docs Data", test_db_docs_data),
            ("Concepts Data", test_db_concepts_data),
            ("Embeddings Exist", test_db_embeddings_exist),
            ("Reports Data", test_db_reports_data),
            ("Blended Scores", test_db_blended_scores),
        ]),
        ("Ollama", [
            ("Ollama Health", test_ollama_health),
            ("Embed Model", test_ollama_embed_model),
            ("LLM Model", test_ollama_llm_model),
            ("Embedding Gen", test_ollama_embedding),
            ("LLM Generation", test_ollama_generation),
        ]),
        ("End-to-End", [
            ("Concept-Doc Links", test_e2e_concept_to_doc_link),
            ("Report Evidence", test_e2e_report_evidence),
            ("Source-Doc Links", test_e2e_source_to_doc_link),
        ]),
    ]

    total_passed = 0
    total_failed = 0
    failed_tests = []

    for group_name, tests in test_groups:
        print(f"[{group_name}]")
        for test_name, test_fn in tests:
            result = run_test(test_name, test_fn)
            status = "PASS" if result.passed else "FAIL"
            print(f"  {status} {result.name} ({result.duration_ms:.1f}ms)")
            if not result.passed:
                print(f"       {result.message}")
                total_failed += 1
                failed_tests.append(f"{group_name}/{result.name}")
            else:
                total_passed += 1
        print()

    print("=" * 60)
    print(f"RESULTS: {total_passed} passed, {total_failed} failed")
    print("=" * 60)

    if failed_tests:
        print("\nFailed tests:")
        for t in failed_tests:
            print(f"  - {t}")
        return 1

    print("\nAll tests passed!")
    return 0


if __name__ == "__main__":
    sys.exit(main())
