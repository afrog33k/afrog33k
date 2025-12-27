"""
Tests for the embedder service
"""

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    """Create a test client for the embedder API."""
    from main import app
    return TestClient(app)


class TestHealth:
    """Health endpoint tests."""

    def test_health_returns_ok(self, client):
        """Health endpoint should return status ok when model is loaded."""
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert "model" in data


class TestEmbed:
    """Embedding endpoint tests."""

    def test_embed_single_text(self, client):
        """Should generate embedding for single text."""
        response = client.post("/embed", json={"texts": ["Hello world"]})
        assert response.status_code == 200
        data = response.json()
        assert "embeddings" in data
        assert len(data["embeddings"]) == 1
        assert isinstance(data["embeddings"][0], list)
        assert len(data["embeddings"][0]) > 0  # Non-empty embedding
        assert "dimension" in data

    def test_embed_multiple_texts(self, client):
        """Should generate embeddings for multiple texts."""
        texts = ["First text", "Second text", "Third text"]
        response = client.post("/embed", json={"texts": texts})
        assert response.status_code == 200
        data = response.json()
        assert len(data["embeddings"]) == 3

    def test_embed_empty_list(self, client):
        """Should handle empty text list."""
        response = client.post("/embed", json={"texts": []})
        assert response.status_code == 200
        data = response.json()
        assert data["embeddings"] == []

    def test_embed_single_endpoint(self, client):
        """Should generate single embedding via query param."""
        response = client.post("/embed/single", params={"text": "Test text"})
        assert response.status_code == 200
        data = response.json()
        assert "embedding" in data
        assert isinstance(data["embedding"], list)

    def test_embeddings_are_normalized(self, client):
        """Embeddings should have consistent dimensionality."""
        texts = ["Short", "This is a much longer sentence with more words"]
        response = client.post("/embed", json={"texts": texts})
        data = response.json()

        # Both should have same dimension
        assert len(data["embeddings"][0]) == len(data["embeddings"][1])
        assert len(data["embeddings"][0]) == data["dimension"]


class TestSimilarity:
    """Similarity search tests."""

    def test_find_similar(self, client):
        """Should find most similar candidates."""
        response = client.post("/similarity", json={
            "query": "machine learning algorithms",
            "candidates": [
                "deep learning neural networks",
                "cooking recipes and food",
                "artificial intelligence systems",
                "gardening tips",
            ],
            "top_k": 2
        })
        assert response.status_code == 200
        data = response.json()
        assert "results" in data
        assert len(data["results"]) == 2

        # Results should have required fields
        for result in data["results"]:
            assert "index" in result
            assert "text" in result
            assert "similarity" in result

    def test_similarity_scores_ordered(self, client):
        """Results should be ordered by similarity (descending)."""
        response = client.post("/similarity", json={
            "query": "python programming",
            "candidates": ["java code", "python script", "cooking"],
            "top_k": 3
        })
        data = response.json()
        scores = [r["similarity"] for r in data["results"]]
        assert scores == sorted(scores, reverse=True)

    def test_similarity_empty_candidates(self, client):
        """Should handle empty candidates list."""
        response = client.post("/similarity", json={
            "query": "test",
            "candidates": [],
            "top_k": 5
        })
        assert response.status_code == 200
        data = response.json()
        assert data["results"] == []


class TestCluster:
    """Clustering tests."""

    def test_cluster_texts(self, client):
        """Should cluster texts into groups."""
        texts = [
            "python programming",
            "java development",
            "cooking recipes",
            "baking bread",
            "javascript code",
            "making pasta"
        ]
        response = client.post("/cluster", params={"n_clusters": 2}, json=texts)
        assert response.status_code == 200
        data = response.json()
        assert "clusters" in data
        assert "n_clusters" in data

        # All texts should be assigned
        total_items = sum(len(items) for items in data["clusters"].values())
        assert total_items == len(texts)

    def test_cluster_few_items(self, client):
        """Should handle fewer items than clusters."""
        texts = ["one", "two"]
        response = client.post("/cluster", params={"n_clusters": 5}, json=texts)
        assert response.status_code == 200
        data = response.json()
        # Should reduce clusters to match items
        assert data["n_clusters"] <= len(texts)


class TestEmbeddingQuality:
    """Tests for embedding quality and semantic similarity."""

    def test_similar_texts_have_similar_embeddings(self, client):
        """Semantically similar texts should have similar embeddings."""
        response = client.post("/embed", json={
            "texts": [
                "The cat sat on the mat",
                "A feline rested on the rug",
                "Quantum physics experiments"
            ]
        })
        data = response.json()

        import numpy as np
        embeddings = np.array(data["embeddings"])

        # Cosine similarity between first two should be higher than first and third
        def cosine_sim(a, b):
            return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

        sim_cats = cosine_sim(embeddings[0], embeddings[1])
        sim_cat_physics = cosine_sim(embeddings[0], embeddings[2])

        assert sim_cats > sim_cat_physics, "Similar texts should have higher similarity"
