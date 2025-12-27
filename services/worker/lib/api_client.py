"""
API client for communicating with the Ronald API service
"""

import os
from typing import Any, Optional
import httpx

API_URL = os.getenv("API_URL", "http://api:3001")


class ApiClient:
    def __init__(self, base_url: str = API_URL):
        self.base_url = base_url
        self.client = httpx.Client(timeout=30.0)

    def _url(self, path: str) -> str:
        return f"{self.base_url}/api{path}"

    # Jobs
    def claim_job(self, job_types: Optional[list[str]] = None) -> Optional[dict]:
        """Claim the next pending job."""
        payload = {"job_types": job_types} if job_types else {}
        resp = self.client.post(self._url("/jobs/claim"), json=payload)
        resp.raise_for_status()
        return resp.json().get("job")

    def complete_job(self, job_id: str) -> None:
        """Mark a job as completed."""
        resp = self.client.patch(self._url(f"/jobs/{job_id}/complete"))
        resp.raise_for_status()

    def fail_job(self, job_id: str, error_message: str) -> None:
        """Mark a job as failed."""
        resp = self.client.patch(
            self._url(f"/jobs/{job_id}/fail"),
            json={"error_message": error_message}
        )
        resp.raise_for_status()

    def create_job(self, job_type: str, payload: dict, priority: int = 0) -> str:
        """Create a new job."""
        resp = self.client.post(
            self._url("/jobs"),
            json={"job_type": job_type, "payload_json": str(payload), "priority": priority}
        )
        resp.raise_for_status()
        return resp.json()["id"]

    # Reports
    def create_report(self, report: dict) -> str:
        """Create a new report."""
        resp = self.client.post(self._url("/reports"), json=report)
        resp.raise_for_status()
        return resp.json()["id"]

    # Sources
    def get_unprocessed_sources(self, limit: int = 10) -> list[dict]:
        """Get unprocessed sources."""
        resp = self.client.get(self._url("/sources"), params={"processed": "false", "limit": limit})
        resp.raise_for_status()
        return resp.json()["sources"]

    def mark_source_processed(self, source_id: str) -> None:
        """Mark a source as processed."""
        resp = self.client.patch(self._url(f"/sources/{source_id}/mark-processed"))
        resp.raise_for_status()

    # Visit clusters
    def get_unprocessed_clusters(self, limit: int = 5) -> list[dict]:
        """Get unprocessed visit clusters."""
        resp = self.client.get(self._url("/visits/clusters"), params={"processed": "false", "limit": limit})
        resp.raise_for_status()
        return resp.json()["clusters"]

    def mark_cluster_processed(self, cluster_id: str) -> None:
        """Mark a cluster as processed."""
        resp = self.client.patch(self._url(f"/visits/clusters/{cluster_id}/mark-processed"))
        resp.raise_for_status()

    # Concepts
    def create_concept(self, label: str, description: Optional[str] = None) -> dict:
        """Create or get a concept."""
        resp = self.client.post(
            self._url("/concepts"),
            json={"label": label, "description": description}
        )
        resp.raise_for_status()
        return resp.json()

    def mention_concept(self, concept_id: str, entity_type: str, entity_id: str, confidence: float = 1.0) -> None:
        """Record a concept mention."""
        resp = self.client.post(
            self._url("/concepts/mention"),
            json={
                "concept_id": concept_id,
                "entity_type": entity_type,
                "entity_id": entity_id,
                "confidence": confidence
            }
        )
        resp.raise_for_status()

    # System state
    def get_system_state(self, key: str) -> Any:
        """Get a system state value."""
        resp = self.client.get(self._url(f"/system/state/{key}"))
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return resp.json()["value"]

    def set_system_state(self, key: str, value: Any) -> None:
        """Set a system state value."""
        resp = self.client.put(self._url(f"/system/state/{key}"), json={"value": value})
        resp.raise_for_status()

    def close(self):
        self.client.close()
