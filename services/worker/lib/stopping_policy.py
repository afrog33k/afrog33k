"""
Stopping Policy Module
Determines when report generation should stop based on completeness,
cost, and predicted satisfaction.
"""

import os
from typing import Dict, Any, Optional
from dataclasses import dataclass
from urllib.request import urlopen, Request
import json

API_URL = os.environ.get("API_URL", "http://localhost:3001")

# Cost thresholds
MAX_TOKENS_PER_REPORT = 50000
MAX_DOLLARS_PER_REPORT = 0.50

# Completeness thresholds by report type
COMPLETENESS_REQUIREMENTS = {
    "decision_memo": {
        "min_findings": 2,
        "min_evidence": 2,
        "requires_decision": True,
        "min_summary_length": 100,
    },
    "research_brief": {
        "min_findings": 3,
        "min_evidence": 3,
        "requires_decision": False,
        "min_summary_length": 150,
    },
    "repo_signal": {
        "min_findings": 1,
        "min_evidence": 1,
        "requires_decision": False,
        "min_summary_length": 50,
    },
    "concept_drift": {
        "min_findings": 2,
        "min_evidence": 1,
        "requires_decision": False,
        "min_summary_length": 50,
    },
    "watchlist_alert": {
        "min_findings": 1,
        "min_evidence": 1,
        "requires_decision": False,
        "min_summary_length": 30,
    },
}


@dataclass
class StopDecision:
    """Result of stopping policy evaluation."""
    should_stop: bool
    reason: str
    completeness: float
    cost_tokens: int
    cost_dollars: float
    marginal_value_estimate: float


def check_completeness(report: Dict[str, Any]) -> tuple[float, Dict[str, bool]]:
    """
    Check if report meets completeness criteria.
    Returns (score, checks_dict).
    """
    report_type = report.get("type", "research_brief")
    reqs = COMPLETENESS_REQUIREMENTS.get(report_type, COMPLETENESS_REQUIREMENTS["research_brief"])

    findings = report.get("findings", [])
    if isinstance(findings, str):
        try:
            findings = json.loads(findings)
        except:
            findings = []

    evidence = report.get("evidence", [])
    if isinstance(evidence, str):
        try:
            evidence = json.loads(evidence)
        except:
            evidence = []

    summary = report.get("summary", "") or ""
    decision = report.get("decision", "") or ""

    checks = {
        "has_title": bool(report.get("title")),
        "has_summary": len(summary) >= reqs["min_summary_length"],
        "has_findings": len(findings) >= reqs["min_findings"],
        "has_evidence": len(evidence) >= reqs["min_evidence"],
        "has_decision": not reqs["requires_decision"] or bool(decision),
        "has_concepts": len(report.get("concept_ids", [])) >= 1,
    }

    score = sum(checks.values()) / len(checks)
    return score, checks


def estimate_marginal_value(
    report: Dict[str, Any],
    iteration: int,
    previous_completeness: float,
    current_completeness: float,
) -> float:
    """
    Estimate the marginal value of continuing generation.
    Returns value between 0 and 1.
    """
    # Diminishing returns after each iteration
    iteration_decay = 0.8 ** iteration

    # Value from completeness improvement
    improvement = current_completeness - previous_completeness
    improvement_value = improvement * 2  # Scale up small improvements

    # Base value from being incomplete
    incomplete_value = (1 - current_completeness) * 0.5

    # Combine
    marginal_value = (improvement_value + incomplete_value) * iteration_decay

    return min(1.0, max(0.0, marginal_value))


def estimate_marginal_cost(
    tokens_used: int,
    dollars_spent: float,
) -> float:
    """
    Estimate the marginal cost of continuing.
    Returns value between 0 and 1.
    """
    # Cost as fraction of budget
    token_cost = tokens_used / MAX_TOKENS_PER_REPORT
    dollar_cost = dollars_spent / MAX_DOLLARS_PER_REPORT

    return max(token_cost, dollar_cost)


def should_stop(
    report: Dict[str, Any],
    iteration: int = 1,
    tokens_used: int = 0,
    dollars_spent: float = 0.0,
    previous_completeness: float = 0.0,
    learned_threshold: Optional[float] = None,
) -> StopDecision:
    """
    Main stopping policy decision function.

    Args:
        report: Current report state
        iteration: Current generation iteration (1-based)
        tokens_used: Total tokens used so far
        dollars_spent: Total cost so far
        previous_completeness: Completeness score from previous iteration
        learned_threshold: Optional learned threshold from historical satisfaction

    Returns:
        StopDecision with recommendation
    """
    # Check completeness
    completeness, checks = check_completeness(report)

    # Hard stop conditions
    if tokens_used >= MAX_TOKENS_PER_REPORT:
        return StopDecision(
            should_stop=True,
            reason="max_tokens_exceeded",
            completeness=completeness,
            cost_tokens=tokens_used,
            cost_dollars=dollars_spent,
            marginal_value_estimate=0.0,
        )

    if dollars_spent >= MAX_DOLLARS_PER_REPORT:
        return StopDecision(
            should_stop=True,
            reason="max_cost_exceeded",
            completeness=completeness,
            cost_tokens=tokens_used,
            cost_dollars=dollars_spent,
            marginal_value_estimate=0.0,
        )

    # Check if complete enough
    threshold = learned_threshold or 0.8
    if completeness >= threshold:
        return StopDecision(
            should_stop=True,
            reason="completeness_threshold_met",
            completeness=completeness,
            cost_tokens=tokens_used,
            cost_dollars=dollars_spent,
            marginal_value_estimate=0.0,
        )

    # Marginal value vs cost analysis
    marginal_value = estimate_marginal_value(
        report, iteration, previous_completeness, completeness
    )
    marginal_cost = estimate_marginal_cost(tokens_used, dollars_spent)

    # Stop if marginal cost exceeds marginal value
    if marginal_cost > marginal_value and iteration > 1:
        return StopDecision(
            should_stop=True,
            reason="marginal_cost_exceeds_value",
            completeness=completeness,
            cost_tokens=tokens_used,
            cost_dollars=dollars_spent,
            marginal_value_estimate=marginal_value,
        )

    # Continue generating
    return StopDecision(
        should_stop=False,
        reason="continue",
        completeness=completeness,
        cost_tokens=tokens_used,
        cost_dollars=dollars_spent,
        marginal_value_estimate=marginal_value,
    )


def get_learned_threshold(report_type: str) -> Optional[float]:
    """
    Get learned stopping threshold from historical satisfaction data.
    Returns None if not enough data.
    """
    try:
        # Query API for satisfaction stats by report type
        req = Request(
            f"{API_URL}/system/satisfaction-stats?type={report_type}",
            method="GET"
        )
        with urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
            if data.get("sample_size", 0) >= 10:
                return data.get("optimal_completeness_threshold")
    except:
        pass
    return None


def update_cost_tracking(report_id: str, tokens: int, dollars: float):
    """Update cost tracking for a report via API."""
    try:
        payload = json.dumps({
            "cost_tokens": tokens,
            "cost_dollars": dollars,
        }).encode()
        req = Request(
            f"{API_URL}/reports/{report_id}/cost",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="PATCH"
        )
        with urlopen(req, timeout=5) as resp:
            return json.loads(resp.read())
    except Exception as e:
        print(f"Failed to update cost tracking: {e}")
        return None
