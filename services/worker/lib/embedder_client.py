"""
Client for the embedder service
"""

import os
from typing import Optional
import httpx

EMBEDDER_URL = os.getenv("EMBEDDER_URL", "http://embedder:8000")


class EmbedderClient:
    def __init__(self, base_url: str = EMBEDDER_URL):
        self.base_url = base_url
        self.client = httpx.Client(timeout=60.0)

    def embed(self, texts: list[str]) -> list[list[float]]:
        """Generate embeddings for texts."""
        resp = self.client.post(f"{self.base_url}/embed", json={"texts": texts})
        resp.raise_for_status()
        return resp.json()["embeddings"]

    def embed_single(self, text: str) -> list[float]:
        """Generate embedding for a single text."""
        resp = self.client.post(f"{self.base_url}/embed/single", params={"text": text})
        resp.raise_for_status()
        return resp.json()["embedding"]

    def find_similar(
        self,
        query: str,
        candidates: list[str],
        top_k: int = 5
    ) -> list[dict]:
        """Find most similar candidates to query."""
        resp = self.client.post(
            f"{self.base_url}/similarity",
            json={"query": query, "candidates": candidates, "top_k": top_k}
        )
        resp.raise_for_status()
        return resp.json()["results"]

    def cluster(self, texts: list[str], n_clusters: int = 5) -> dict:
        """Cluster texts."""
        resp = self.client.post(
            f"{self.base_url}/cluster",
            params={"n_clusters": n_clusters},
            json=texts
        )
        resp.raise_for_status()
        return resp.json()

    def is_available(self) -> bool:
        """Check if embedder is available."""
        try:
            resp = self.client.get(f"{self.base_url}/health")
            return resp.status_code == 200
        except Exception:
            return False

    def close(self):
        self.client.close()
