"""
Synthesis Flow - Generate reports from research
"""

import json
from typing import Optional
from pocketflow import Node, Flow

from lib.api_client import ApiClient
from lib.guardrails import GuardedOutput


REPORT_SYSTEM_PROMPT = """You are Ronald-GI, an autonomous research colleague.
Your tone is direct, calm, and judgment-forward. You speak as a colleague, never as a boss.
You produce structured reports that help reduce cognitive burden and compress decisions.

Report types:
- decision_memo: When research suggests a clear action to take or avoid
- research_brief: When providing analysis and understanding without a specific decision
- repo_signal: When analyzing a code repository
- concept_drift: When suggesting to merge, kill, or relabel concepts
- watchlist_alert: When something new appears near the frontier of interest
"""


class DetermineReportTypeNode(Node):
    """Determine the appropriate report type."""

    def exec(self, research_data):
        if not research_data:
            return None

        insights = research_data.get("insights", {})
        candidate = research_data.get("candidate", {})

        # Determine type based on content
        if insights.get("decision_relevant"):
            report_type = "decision_memo"
        elif candidate.get("type") == "source" and "github.com" in candidate.get("url", ""):
            report_type = "repo_signal"
        else:
            report_type = "research_brief"

        research_data["report_type"] = report_type
        return research_data


class GenerateReportNode(Node):
    """Generate the full report using LLM."""

    def prep(self, shared):
        self.ollama = shared.get("ollama")
        self.guard = GuardedOutput(strict=True)

    def exec(self, research_data):
        if not research_data:
            return None

        report_type = research_data.get("report_type", "research_brief")
        insights = research_data.get("insights", {})
        evidence = research_data.get("evidence", [])
        candidate = research_data.get("candidate", {})

        prompt = f"""Generate a {report_type} report based on this research.

Insights:
{json.dumps(insights, indent=2)}

Evidence sources:
{json.dumps([e["title"] for e in evidence], indent=2)}

Candidate context:
- Type: {candidate.get("type")}
- Scores: {json.dumps(candidate.get("scores", {}), indent=2)}

Generate a JSON report with these fields:
- title: A clear, concise title (max 80 chars)
- summary: 2-3 sentence summary
- findings: List of key findings (strings)
- decision: If decision_memo, the recommended decision. Otherwise null.
- next_actions: List of suggested next steps
- impact_score: 0-1 estimated impact
- novelty_score: 0-1 how novel this is
- relevance_score: 0-1 relevance to current focus
- concepts: List of concept labels to extract/link
- ui_blocks: List of UI blocks for rendering (each with "type" and "content")

UI block types: "kpi", "bullet", "link", "note", "code"

JSON:"""

        try:
            report = self.ollama.generate_json(prompt, system=REPORT_SYSTEM_PROMPT)

            # Guard check on report content
            if report.get("summary"):
                report["summary"] = self.guard.check(report["summary"], "report")
            if report.get("decision"):
                report["decision"] = self.guard.check(report["decision"], "report")

            research_data["report"] = report
        except Exception as e:
            research_data["report"] = {
                "title": f"Research: {candidate.get('url', candidate.get('id', 'Unknown'))}",
                "summary": insights.get("summary", "Analysis completed"),
                "findings": insights.get("key_findings", []),
                "decision": None,
                "next_actions": [],
                "impact_score": candidate.get("scores", {}).get("impact", 0.5),
                "novelty_score": candidate.get("scores", {}).get("novelty", 0.5),
                "relevance_score": candidate.get("scores", {}).get("relevance", 0.5),
                "concepts": insights.get("concepts", []),
                "ui_blocks": [],
                "error": str(e),
            }

        return research_data


class SaveReportNode(Node):
    """Save the report to the database."""

    def prep(self, shared):
        self.api = shared.get("api")

    def exec(self, research_data):
        if not research_data or not research_data.get("report"):
            return None

        report = research_data["report"]
        candidate = research_data.get("candidate", {})
        evidence = research_data.get("evidence", [])
        report_type = research_data.get("report_type", "research_brief")

        # Determine if promoted (show in 3+1)
        blended_score = (
            0.45 * report.get("impact_score", 0) +
            0.45 * report.get("novelty_score", 0) +
            0.10 * report.get("relevance_score", 0)
        )
        promoted = 1 if blended_score > 0.4 else 0

        # Create report via API
        report_id = self.api.create_report({
            "type": report_type,
            "title": report.get("title", "Untitled Report"),
            "summary": report.get("summary"),
            "findings_json": json.dumps(report.get("findings", [])),
            "decision": report.get("decision"),
            "next_actions_json": json.dumps(report.get("next_actions", [])),
            "evidence_json": json.dumps(evidence),
            "ui_blocks_json": json.dumps(report.get("ui_blocks", [])),
            "concept_ids_json": json.dumps([]),  # Will be linked later
            "impact_score": report.get("impact_score", 0),
            "novelty_score": report.get("novelty_score", 0),
            "relevance_score": report.get("relevance_score", 0),
            "promoted": promoted,
            "source_cluster_id": candidate.get("id") if candidate.get("type") == "cluster" else None,
            "source_id": candidate.get("id") if candidate.get("type") == "source" else None,
        })

        # Mark candidate as processed
        if candidate.get("type") == "cluster":
            self.api.mark_cluster_processed(candidate["id"])
        elif candidate.get("type") == "source":
            self.api.mark_source_processed(candidate["id"])

        # Create/link concepts
        for concept_label in report.get("concepts", []):
            try:
                concept = self.api.create_concept(concept_label)
                self.api.mention_concept(
                    concept["id"],
                    entity_type="report",
                    entity_id=report_id
                )
            except Exception as e:
                print(f"Failed to link concept {concept_label}: {e}")

        return {
            "report_id": report_id,
            "report": report,
            "promoted": promoted,
        }


def create_synthesis_flow(api: ApiClient, ollama) -> Flow:
    """Create the synthesis flow."""
    determine_type = DetermineReportTypeNode()
    generate_report = GenerateReportNode()
    save_report = SaveReportNode()

    determine_type >> generate_report >> save_report

    flow = Flow(start=determine_type)
    flow.shared = {"api": api, "ollama": ollama}

    return flow
