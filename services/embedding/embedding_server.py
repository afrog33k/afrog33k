#!/usr/bin/env python3
"""
Ronald-GI Embedding Service

Provides semantic embeddings for the memory system using sentence-transformers.
This is the critical piece that makes RAG and persona consistency work.

Models:
- all-MiniLM-L6-v2: Fast, 384 dimensions (default)
- all-mpnet-base-v2: Better quality, 768 dimensions

Usage:
    python embedding_server.py [--port 8787] [--model all-MiniLM-L6-v2]
"""

import argparse
import json
import os
import time
from typing import List, Dict, Any

import numpy as np
from flask import Flask, request, jsonify
from sentence_transformers import SentenceTransformer

app = Flask(__name__)

# Global model instance
model: SentenceTransformer = None
model_name: str = None
dimension: int = 0


def load_model(name: str = "all-MiniLM-L6-v2"):
    """Load the embedding model."""
    global model, model_name, dimension

    print(f"Loading model: {name}...")
    start = time.time()
    model = SentenceTransformer(name)
    model_name = name
    dimension = model.get_sentence_embedding_dimension()
    print(f"Model loaded in {time.time() - start:.2f}s (dimension: {dimension})")


@app.route("/health", methods=["GET"])
def health():
    """Health check endpoint."""
    return jsonify({
        "status": "healthy",
        "model": model_name,
        "dimension": dimension
    })


@app.route("/embed", methods=["POST"])
def embed():
    """
    Embed text(s) into vectors.

    Request body:
        {"text": "single text"} or {"texts": ["text1", "text2", ...]}

    Response:
        {"embeddings": [[...], [...]], "dimension": 384}
    """
    try:
        data = request.json

        if "text" in data:
            texts = [data["text"]]
        elif "texts" in data:
            texts = data["texts"]
        else:
            return jsonify({"error": "Missing 'text' or 'texts' field"}), 400

        if not texts:
            return jsonify({"error": "Empty text list"}), 400

        # Generate embeddings
        embeddings = model.encode(texts, convert_to_numpy=True)

        # Convert to list for JSON serialization
        embeddings_list = embeddings.tolist()

        return jsonify({
            "embeddings": embeddings_list,
            "dimension": dimension,
            "count": len(texts)
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/similarity", methods=["POST"])
def similarity():
    """
    Calculate cosine similarity between a query and documents.

    Request body:
        {
            "query": "search query text",
            "documents": ["doc1", "doc2", ...],
            "top_k": 5
        }

    Response:
        {
            "results": [
                {"index": 0, "score": 0.95, "document": "doc1"},
                ...
            ]
        }
    """
    try:
        data = request.json

        query = data.get("query")
        documents = data.get("documents", [])
        top_k = data.get("top_k", 10)

        if not query:
            return jsonify({"error": "Missing 'query' field"}), 400

        if not documents:
            return jsonify({"error": "Empty documents list"}), 400

        # Embed query and documents
        query_embedding = model.encode([query], convert_to_numpy=True)[0]
        doc_embeddings = model.encode(documents, convert_to_numpy=True)

        # Calculate cosine similarity
        query_norm = np.linalg.norm(query_embedding)
        doc_norms = np.linalg.norm(doc_embeddings, axis=1)

        # Avoid division by zero
        doc_norms = np.where(doc_norms == 0, 1, doc_norms)

        similarities = np.dot(doc_embeddings, query_embedding) / (doc_norms * query_norm)

        # Sort by similarity (descending)
        sorted_indices = np.argsort(similarities)[::-1][:top_k]

        results = [
            {
                "index": int(idx),
                "score": float(similarities[idx]),
                "document": documents[idx]
            }
            for idx in sorted_indices
            if similarities[idx] > 0
        ]

        return jsonify({"results": results})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/batch_similarity", methods=["POST"])
def batch_similarity():
    """
    Pre-compute embeddings for batch storage.

    Request body:
        {
            "items": [
                {"id": "id1", "content": "text1"},
                {"id": "id2", "content": "text2"}
            ]
        }

    Response:
        {
            "embeddings": {
                "id1": [...],
                "id2": [...]
            }
        }
    """
    try:
        data = request.json
        items = data.get("items", [])

        if not items:
            return jsonify({"error": "Empty items list"}), 400

        ids = [item["id"] for item in items]
        contents = [item["content"] for item in items]

        # Generate embeddings
        embeddings = model.encode(contents, convert_to_numpy=True)

        # Create id -> embedding map
        result = {
            id_: embedding.tolist()
            for id_, embedding in zip(ids, embeddings)
        }

        return jsonify({
            "embeddings": result,
            "dimension": dimension,
            "count": len(items)
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


def main():
    parser = argparse.ArgumentParser(description="Ronald-GI Embedding Server")
    parser.add_argument("--port", type=int, default=8787, help="Port to run server on")
    parser.add_argument("--model", type=str, default="all-MiniLM-L6-v2",
                        help="Sentence transformer model to use")
    parser.add_argument("--host", type=str, default="127.0.0.1",
                        help="Host to bind to")
    args = parser.parse_args()

    load_model(args.model)

    print(f"\n=== Ronald-GI Embedding Server ===")
    print(f"Model: {model_name}")
    print(f"Dimension: {dimension}")
    print(f"Listening on: http://{args.host}:{args.port}")
    print(f"Endpoints:")
    print(f"  POST /embed - Embed text(s)")
    print(f"  POST /similarity - Search by similarity")
    print(f"  POST /batch_similarity - Batch embed for storage")
    print(f"  GET /health - Health check")
    print()

    app.run(host=args.host, port=args.port, debug=False)


if __name__ == "__main__":
    main()
