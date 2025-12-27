"""
Ronald-GI Embedder Service
FastAPI + sentence-transformers for text embeddings
"""

import os
from typing import List
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import numpy as np
from sentence_transformers import SentenceTransformer

MODEL_NAME = os.getenv("MODEL_NAME", "all-MiniLM-L6-v2")

model: SentenceTransformer | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global model
    print(f"Loading model: {MODEL_NAME}")
    model = SentenceTransformer(MODEL_NAME)
    print(f"Model loaded, embedding dimension: {model.get_sentence_embedding_dimension()}")
    yield
    print("Shutting down embedder")


app = FastAPI(
    title="Ronald-GI Embedder",
    description="Text embedding service using sentence-transformers",
    lifespan=lifespan,
)


class EmbedRequest(BaseModel):
    texts: List[str]


class EmbedResponse(BaseModel):
    embeddings: List[List[float]]
    dimension: int


class SimilarityRequest(BaseModel):
    query: str
    candidates: List[str]
    top_k: int = 5


class SimilarityResponse(BaseModel):
    results: List[dict]


@app.get("/health")
async def health():
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    return {"status": "ok", "model": MODEL_NAME}


@app.post("/embed", response_model=EmbedResponse)
async def embed(request: EmbedRequest):
    """Generate embeddings for a list of texts."""
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    if not request.texts:
        return EmbedResponse(embeddings=[], dimension=model.get_sentence_embedding_dimension())

    embeddings = model.encode(request.texts, convert_to_numpy=True)

    return EmbedResponse(
        embeddings=embeddings.tolist(),
        dimension=model.get_sentence_embedding_dimension(),
    )


@app.post("/embed/single")
async def embed_single(text: str):
    """Generate embedding for a single text (query param)."""
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    embedding = model.encode(text, convert_to_numpy=True)

    return {
        "embedding": embedding.tolist(),
        "dimension": model.get_sentence_embedding_dimension(),
    }


@app.post("/similarity", response_model=SimilarityResponse)
async def similarity(request: SimilarityRequest):
    """Find most similar candidates to a query."""
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    if not request.candidates:
        return SimilarityResponse(results=[])

    # Encode query and candidates
    query_embedding = model.encode(request.query, convert_to_numpy=True)
    candidate_embeddings = model.encode(request.candidates, convert_to_numpy=True)

    # Compute cosine similarities
    query_norm = query_embedding / np.linalg.norm(query_embedding)
    candidate_norms = candidate_embeddings / np.linalg.norm(candidate_embeddings, axis=1, keepdims=True)
    similarities = np.dot(candidate_norms, query_norm)

    # Get top-k indices
    top_k = min(request.top_k, len(request.candidates))
    top_indices = np.argsort(similarities)[::-1][:top_k]

    results = [
        {
            "index": int(idx),
            "text": request.candidates[idx],
            "similarity": float(similarities[idx]),
        }
        for idx in top_indices
    ]

    return SimilarityResponse(results=results)


@app.post("/cluster")
async def cluster(texts: List[str], n_clusters: int = 5):
    """Simple k-means clustering of texts."""
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    if len(texts) < n_clusters:
        n_clusters = max(1, len(texts))

    embeddings = model.encode(texts, convert_to_numpy=True)

    # Simple k-means implementation
    from sklearn.cluster import KMeans

    kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
    labels = kmeans.fit_predict(embeddings)

    clusters = {}
    for idx, label in enumerate(labels):
        label_key = int(label)
        if label_key not in clusters:
            clusters[label_key] = []
        clusters[label_key].append({"index": idx, "text": texts[idx]})

    return {"clusters": clusters, "n_clusters": n_clusters}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
