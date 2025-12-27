"""
Ideation Flow - Choose what to research next
"""

import json
import random
from typing import Optional
from pocketflow import Node, Flow

from lib.api_client import ApiClient
from lib.embedder_client import EmbedderClient


class GetCandidatesNode(Node):
    """Get candidate topics for research."""

    def prep(self, shared):
        self.api = shared.get("api")

    def exec(self, _):
        candidates = []

        # 1. Unprocessed visit clusters (discovery spikes)
        clusters = self.api.get_unprocessed_clusters(limit=5)
        for cluster in clusters:
            stats = json.loads(cluster.get("stats_json", "{}"))
            urls = json.loads(cluster.get("urls_json", "[]"))
            candidates.append({
                "type": "cluster",
                "id": cluster["id"],
                "intensity": cluster.get("intensity", 0),
                "hosts": list(stats.get("hosts", {}).keys())[:5],
                "urls": urls[:10],
                "started_at": cluster["started_at"],
            })

        # 2. Unprocessed sources (bookmarks)
        sources = self.api.get_unprocessed_sources(limit=10)
        for source in sources:
            candidates.append({
                "type": "source",
                "id": source["id"],
                "url": source["url"],
                "title": source.get("title", ""),
                "host": source["host"],
                "priority": source.get("priority", 0),
            })

        return candidates


class ScoreCandidatesNode(Node):
    """Score candidates by impact, novelty, relevance."""

    def prep(self, shared):
        self.embedder = shared.get("embedder")
        self.api = shared.get("api")

        # Get ideation weights
        weights = self.api.get_system_state("ideation_weights")
        self.weights = weights or {"impact": 0.45, "novelty": 0.45, "relevance": 0.10}

    def exec(self, candidates):
        if not candidates:
            return []

        scored = []
        for candidate in candidates:
            # Simple scoring heuristics for v1
            if candidate["type"] == "cluster":
                # Clusters: use intensity as base
                impact = min(candidate.get("intensity", 0) / 2, 1.0)
                novelty = 0.5  # Will improve with embeddings
                relevance = 0.5

            else:
                # Sources: use priority
                impact = 0.3
                novelty = 0.6  # New source = novel
                relevance = candidate.get("priority", 0) / 10

            # Compute blended score
            blended = (
                self.weights["impact"] * impact +
                self.weights["novelty"] * novelty +
                self.weights["relevance"] * relevance
            )

            scored.append({
                **candidate,
                "scores": {
                    "impact": impact,
                    "novelty": novelty,
                    "relevance": relevance,
                    "blended": blended,
                }
            })

        # Sort by blended score
        scored.sort(key=lambda x: x["scores"]["blended"], reverse=True)
        return scored


class SelectCandidateNode(Node):
    """Select the best candidate to research."""

    def exec(self, scored_candidates):
        if not scored_candidates:
            return None

        # Top pick by blended score
        top_pick = scored_candidates[0]

        # +1 relevance pick (if different)
        relevance_sorted = sorted(
            scored_candidates,
            key=lambda x: x["scores"]["relevance"],
            reverse=True
        )
        relevance_pick = relevance_sorted[0] if relevance_sorted else None

        # Sometimes pick the relevance one for variety
        if relevance_pick and relevance_pick["id"] != top_pick["id"]:
            if random.random() < 0.2:  # 20% chance
                return relevance_pick

        return top_pick


def create_ideation_flow(api: ApiClient, embedder: EmbedderClient) -> Flow:
    """Create the ideation flow."""
    get_candidates = GetCandidatesNode()
    score_candidates = ScoreCandidatesNode()
    select_candidate = SelectCandidateNode()

    get_candidates >> score_candidates >> select_candidate

    flow = Flow(start=get_candidates)
    flow.shared = {"api": api, "embedder": embedder}

    return flow
