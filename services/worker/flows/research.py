"""
Research Flow - Fetch and extract information from web pages
"""

import json
from typing import Optional
from pocketflow import Node, Flow

from lib.api_client import ApiClient
from lib.browser import WebBrowser
from lib.guardrails import GuardedOutput, has_secrets


class FetchPagesNode(Node):
    """Fetch pages from URLs."""

    def prep(self, shared):
        self.browser = shared.get("browser")
        self.guard = GuardedOutput(strict=True)

    def exec(self, candidate):
        if not candidate:
            return None

        pages = []
        urls = []

        if candidate["type"] == "cluster":
            urls = candidate.get("urls", [])[:5]
        elif candidate["type"] == "source":
            urls = [candidate["url"]]

        with WebBrowser() as browser:
            for url in urls:
                page_data = browser.fetch_page(url)

                # Guard: check for secrets in page content
                if page_data.get("text"):
                    page_data["text"] = self.guard.check(page_data["text"], url)

                if not page_data.get("error"):
                    pages.append(page_data)

        return {
            "candidate": candidate,
            "pages": pages,
            "guard_report": self.guard.get_report(),
        }


class ExtractInsightsNode(Node):
    """Extract key insights from pages using LLM."""

    def prep(self, shared):
        self.ollama = shared.get("ollama")

    def exec(self, research_data):
        if not research_data or not research_data.get("pages"):
            return research_data

        pages = research_data["pages"]
        candidate = research_data["candidate"]

        # Combine page content
        combined_text = ""
        for page in pages[:3]:  # Limit to 3 pages
            combined_text += f"\n\n--- {page['title']} ---\n"
            combined_text += page["text"][:10000]  # Limit per page

        # Truncate total
        combined_text = combined_text[:30000]

        # Extract insights using LLM
        prompt = f"""Analyze the following content and extract key insights.

Content:
{combined_text}

Provide your analysis as JSON with these fields:
- summary: A 2-3 sentence summary
- key_findings: List of 3-5 key findings
- concepts: List of 3-5 key concepts/topics mentioned
- decision_relevant: Boolean - is this relevant for making decisions?
- suggested_decision: If decision_relevant, what decision does this suggest?

JSON:"""

        try:
            result = self.ollama.generate_json(prompt)
            research_data["insights"] = result
        except Exception as e:
            research_data["insights"] = {
                "summary": "Failed to extract insights",
                "key_findings": [],
                "concepts": [],
                "decision_relevant": False,
                "error": str(e),
            }

        return research_data


class CreateEvidenceNode(Node):
    """Create evidence records from research."""

    def exec(self, research_data):
        if not research_data:
            return None

        pages = research_data.get("pages", [])
        evidence = []

        for page in pages:
            evidence.append({
                "url": page["url"],
                "title": page.get("title", ""),
                "excerpt": page.get("text", "")[:500],
            })

        research_data["evidence"] = evidence
        return research_data


def create_research_flow(api: ApiClient, ollama, embedder) -> Flow:
    """Create the research flow."""
    fetch_pages = FetchPagesNode()
    extract_insights = ExtractInsightsNode()
    create_evidence = CreateEvidenceNode()

    fetch_pages >> extract_insights >> create_evidence

    flow = Flow(start=fetch_pages)
    flow.shared = {"api": api, "ollama": ollama, "embedder": embedder}

    return flow
