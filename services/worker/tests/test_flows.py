"""
Tests for PocketFlow flows
"""

import pytest
from unittest.mock import Mock, patch, MagicMock
import json


class MockApiClient:
    """Mock API client for testing."""

    def __init__(self):
        self.clusters = []
        self.sources = []
        self.reports = []
        self.concepts = {}

    def get_unprocessed_clusters(self, limit=5):
        return self.clusters[:limit]

    def get_unprocessed_sources(self, limit=10):
        return self.sources[:limit]

    def get_system_state(self, key):
        if key == "ideation_weights":
            return {"impact": 0.45, "novelty": 0.45, "relevance": 0.10}
        return None

    def create_report(self, report):
        report_id = f"report-{len(self.reports)}"
        self.reports.append({**report, "id": report_id})
        return report_id

    def mark_cluster_processed(self, cluster_id):
        pass

    def mark_source_processed(self, source_id):
        pass

    def create_concept(self, label, description=None):
        if label not in self.concepts:
            self.concepts[label] = {"id": f"concept-{len(self.concepts)}", "label": label}
        return self.concepts[label]

    def mention_concept(self, concept_id, entity_type, entity_id, confidence=1.0):
        pass


class MockEmbedderClient:
    """Mock embedder client for testing."""

    def embed(self, texts):
        return [[0.1] * 384 for _ in texts]

    def is_available(self):
        return True


class MockOllamaClient:
    """Mock Ollama client for testing."""

    def generate_json(self, prompt, system=None, temperature=0.3):
        return {
            "summary": "Test summary",
            "key_findings": ["Finding 1", "Finding 2"],
            "concepts": ["concept-1", "concept-2"],
            "decision_relevant": True,
            "suggested_decision": "Do this",
        }

    def is_available(self):
        return True


class TestIdeationFlow:
    """Tests for the ideation flow."""

    def test_get_candidates_from_clusters(self):
        """Should extract candidates from visit clusters."""
        from flows.ideation import GetCandidatesNode

        api = MockApiClient()
        api.clusters = [
            {
                "id": "cluster-1",
                "intensity": 0.8,
                "stats_json": json.dumps({"hosts": {"github.com": 5, "docs.python.org": 3}}),
                "urls_json": json.dumps(["https://github.com/test", "https://docs.python.org"]),
                "started_at": "2024-01-01T10:00:00"
            }
        ]

        node = GetCandidatesNode()
        node.prep({"api": api})
        candidates = node.exec(None)

        assert len(candidates) == 1
        assert candidates[0]["type"] == "cluster"
        assert candidates[0]["intensity"] == 0.8

    def test_get_candidates_from_sources(self):
        """Should extract candidates from sources."""
        from flows.ideation import GetCandidatesNode

        api = MockApiClient()
        api.sources = [
            {
                "id": "source-1",
                "url": "https://example.com/article",
                "title": "Test Article",
                "host": "example.com",
                "priority": 5
            }
        ]

        node = GetCandidatesNode()
        node.prep({"api": api})
        candidates = node.exec(None)

        assert len(candidates) == 1
        assert candidates[0]["type"] == "source"
        assert candidates[0]["priority"] == 5

    def test_score_candidates(self):
        """Should score candidates with blended score."""
        from flows.ideation import ScoreCandidatesNode

        api = MockApiClient()
        embedder = MockEmbedderClient()

        node = ScoreCandidatesNode()
        node.prep({"api": api, "embedder": embedder})

        candidates = [
            {"type": "cluster", "id": "c1", "intensity": 0.9},
            {"type": "source", "id": "s1", "url": "https://example.com", "priority": 5},
        ]

        scored = node.exec(candidates)

        assert len(scored) == 2
        for c in scored:
            assert "scores" in c
            assert "blended" in c["scores"]
            assert 0 <= c["scores"]["blended"] <= 1

    def test_select_top_candidate(self):
        """Should select candidate with highest blended score."""
        from flows.ideation import SelectCandidateNode

        node = SelectCandidateNode()

        candidates = [
            {"id": "low", "scores": {"blended": 0.3, "relevance": 0.5}},
            {"id": "high", "scores": {"blended": 0.9, "relevance": 0.2}},
            {"id": "mid", "scores": {"blended": 0.5, "relevance": 0.8}},
        ]

        selected = node.exec(candidates)
        assert selected["id"] == "high"

    def test_select_with_empty_candidates(self):
        """Should return None for empty candidates."""
        from flows.ideation import SelectCandidateNode

        node = SelectCandidateNode()
        selected = node.exec([])
        assert selected is None


class TestSynthesisFlow:
    """Tests for the synthesis flow."""

    def test_determine_report_type_decision(self):
        """Should determine decision_memo when decision relevant."""
        from flows.synthesis import DetermineReportTypeNode

        node = DetermineReportTypeNode()

        research_data = {
            "candidate": {"type": "source", "url": "https://example.com"},
            "insights": {"decision_relevant": True}
        }

        result = node.exec(research_data)
        assert result["report_type"] == "decision_memo"

    def test_determine_report_type_repo(self):
        """Should determine repo_signal for GitHub sources."""
        from flows.synthesis import DetermineReportTypeNode

        node = DetermineReportTypeNode()

        research_data = {
            "candidate": {"type": "source", "url": "https://github.com/user/repo"},
            "insights": {"decision_relevant": False}
        }

        result = node.exec(research_data)
        assert result["report_type"] == "repo_signal"

    def test_determine_report_type_research(self):
        """Should default to research_brief."""
        from flows.synthesis import DetermineReportTypeNode

        node = DetermineReportTypeNode()

        research_data = {
            "candidate": {"type": "cluster"},
            "insights": {"decision_relevant": False}
        }

        result = node.exec(research_data)
        assert result["report_type"] == "research_brief"

    def test_save_report_creates_record(self):
        """Should save report via API."""
        from flows.synthesis import SaveReportNode

        api = MockApiClient()
        node = SaveReportNode()
        node.prep({"api": api})

        research_data = {
            "report_type": "decision_memo",
            "candidate": {"type": "source", "id": "s1", "scores": {"impact": 0.5}},
            "evidence": [{"url": "https://example.com", "title": "Test", "excerpt": "..."}],
            "report": {
                "title": "Test Report",
                "summary": "Test summary",
                "findings": ["Finding 1"],
                "decision": "Do this",
                "next_actions": ["Action 1"],
                "impact_score": 0.8,
                "novelty_score": 0.7,
                "relevance_score": 0.5,
                "concepts": ["ml", "ai"],
                "ui_blocks": []
            }
        }

        result = node.exec(research_data)

        assert result is not None
        assert "report_id" in result
        assert len(api.reports) == 1


class TestResearchFlow:
    """Tests for the research flow."""

    def test_create_evidence_from_pages(self):
        """Should create evidence records from fetched pages."""
        from flows.research import CreateEvidenceNode

        node = CreateEvidenceNode()

        research_data = {
            "pages": [
                {"url": "https://example.com/1", "title": "Page 1", "text": "Content 1..."},
                {"url": "https://example.com/2", "title": "Page 2", "text": "Content 2..."},
            ]
        }

        result = node.exec(research_data)

        assert "evidence" in result
        assert len(result["evidence"]) == 2
        assert result["evidence"][0]["url"] == "https://example.com/1"

    def test_handle_empty_pages(self):
        """Should handle no pages gracefully."""
        from flows.research import CreateEvidenceNode

        node = CreateEvidenceNode()

        result = node.exec({"pages": []})
        assert result["evidence"] == []

    def test_handle_none_input(self):
        """Should handle None input."""
        from flows.research import CreateEvidenceNode

        node = CreateEvidenceNode()
        result = node.exec(None)
        assert result is None
