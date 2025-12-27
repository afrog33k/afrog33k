#!/usr/bin/env python3
"""
Ingest paulbricman's GitHub repositories as priors for Ronald-GI
"""

import json
import sqlite3
import hashlib
import subprocess
import os
import sys
from datetime import datetime
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import HTTPError

# Configuration
GITHUB_USER = "paulbricman"
DB_PATH = os.environ.get("DATABASE_PATH", "/worktrees/afrog33k/dexter/data/ronald.db")
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen3:0.6b")
EMBED_MODEL = os.environ.get("EMBED_MODEL", "nomic-embed-text")

def fetch_repos(username: str) -> list:
    """Fetch all public repos for a GitHub user."""
    repos = []
    page = 1

    while True:
        url = f"https://api.github.com/users/{username}/repos?per_page=100&page={page}"
        req = Request(url, headers={"User-Agent": "Ronald-GI"})

        try:
            with urlopen(req) as resp:
                data = json.loads(resp.read())
                if not data:
                    break
                repos.extend(data)
                page += 1
        except HTTPError as e:
            print(f"Error fetching repos: {e}")
            break

    return repos


def fetch_readme(repo: dict) -> str:
    """Fetch README content for a repo."""
    # Try common README filenames
    for filename in ["README.md", "readme.md", "README", "README.rst"]:
        url = f"https://raw.githubusercontent.com/{repo['full_name']}/{repo['default_branch']}/{filename}"
        req = Request(url, headers={"User-Agent": "Ronald-GI"})

        try:
            with urlopen(req) as resp:
                return resp.read().decode("utf-8", errors="ignore")
        except HTTPError:
            continue

    return ""


def get_embedding(text: str) -> list:
    """Get embedding from Ollama."""
    import urllib.request

    payload = json.dumps({"model": EMBED_MODEL, "input": text[:8000]}).encode()
    req = Request(
        f"{OLLAMA_URL}/api/embed",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    try:
        with urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
            return data.get("embeddings", [[]])[0]
    except Exception as e:
        print(f"  Embedding error: {e}")
        return []


def extract_concepts(text: str, title: str) -> list:
    """Extract concepts from text using Ollama."""
    import urllib.request

    prompt = f"""Analyze this repository README and extract 3-5 key concepts/topics.

Title: {title}
Content (first 2000 chars):
{text[:2000]}

Return ONLY a JSON array of concept strings, like: ["concept1", "concept2", "concept3"]
No explanation, just the JSON array:"""

    payload = json.dumps({
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.3}
    }).encode()

    req = Request(
        f"{OLLAMA_URL}/api/generate",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    try:
        with urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read())
            response = data.get("response", "[]")
            # Extract JSON array from response
            import re
            match = re.search(r'\[.*?\]', response, re.DOTALL)
            if match:
                return json.loads(match.group())
    except Exception as e:
        print(f"  Concept extraction error: {e}")

    return []


def generate_summary(text: str, title: str) -> str:
    """Generate a brief summary using Ollama."""
    import urllib.request

    prompt = f"""Summarize this repository in 1-2 sentences. Be concise and focus on what it does.

Title: {title}
Content (first 1500 chars):
{text[:1500]}

Summary:"""

    payload = json.dumps({
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.3, "num_predict": 100}
    }).encode()

    req = Request(
        f"{OLLAMA_URL}/api/generate",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    try:
        with urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read())
            return data.get("response", "").strip()[:500]
    except Exception as e:
        print(f"  Summary error: {e}")

    return ""


def uid() -> str:
    """Generate a unique ID."""
    import uuid
    return uuid.uuid4().hex


def main():
    print(f"=== Ingesting {GITHUB_USER}'s GitHub Repos ===")
    print(f"Database: {DB_PATH}")
    print(f"Ollama: {OLLAMA_URL} (model: {OLLAMA_MODEL})")
    print()

    # Connect to database
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Fetch repos
    print(f"Fetching repos for {GITHUB_USER}...")
    repos = fetch_repos(GITHUB_USER)
    print(f"Found {len(repos)} repositories")
    print()

    # Filter out forks
    original_repos = [r for r in repos if not r.get("fork")]
    print(f"Processing {len(original_repos)} original repos (excluding forks)")
    print()

    sources_added = 0
    docs_added = 0
    concepts_added = 0

    for i, repo in enumerate(original_repos):
        name = repo["name"]
        url = repo["html_url"]
        description = repo.get("description") or ""

        print(f"[{i+1}/{len(original_repos)}] {name}")

        # Add as source
        source_id = uid()
        try:
            cursor.execute("""
                INSERT OR IGNORE INTO sources (id, url, title, description, host, tags_json, priority)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                source_id,
                url,
                name,
                description,
                "github.com",
                json.dumps(["bricman", "prior", repo.get("language", "").lower() or "general"]),
                5  # High priority as priors
            ))
            if cursor.rowcount > 0:
                sources_added += 1
        except Exception as e:
            print(f"  Source error: {e}")
            continue

        # Fetch and process README
        readme = fetch_readme(repo)
        if not readme:
            print(f"  No README found")
            continue

        content_hash = hashlib.sha256(readme.encode()).hexdigest()

        # Check if already processed
        cursor.execute("SELECT id FROM docs WHERE content_hash = ?", (content_hash,))
        if cursor.fetchone():
            print(f"  Already processed")
            continue

        # Generate embedding
        print(f"  Generating embedding...")
        embedding = get_embedding(f"{name}\n{description}\n{readme[:2000]}")
        embedding_blob = None
        if embedding:
            import struct
            embedding_blob = struct.pack(f'{len(embedding)}f', *embedding)

        # Extract concepts
        print(f"  Extracting concepts...")
        concepts = extract_concepts(readme, name)
        print(f"  Found concepts: {concepts}")

        # Generate summary
        print(f"  Generating summary...")
        summary = generate_summary(readme, name)

        # Store document
        doc_id = uid()
        try:
            cursor.execute("""
                INSERT INTO docs (id, source_url, source_type, content, content_hash, embedding, metadata_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                doc_id,
                url,
                "repo_readme",
                readme[:50000],  # Limit content size
                content_hash,
                embedding_blob,
                json.dumps({
                    "repo_name": name,
                    "description": description,
                    "stars": repo.get("stargazers_count", 0),
                    "language": repo.get("language"),
                    "summary": summary,
                    "concepts": concepts
                })
            ))
            docs_added += 1
        except Exception as e:
            print(f"  Doc error: {e}")
            continue

        # Create/link concepts
        for concept_label in concepts:
            concept_label = concept_label.lower().strip()
            if not concept_label:
                continue

            # Create or get concept
            cursor.execute("SELECT id FROM concepts WHERE label = ?", (concept_label,))
            row = cursor.fetchone()
            if row:
                concept_id = row[0]
            else:
                concept_id = uid()
                cursor.execute("""
                    INSERT INTO concepts (id, label, description)
                    VALUES (?, ?, ?)
                """, (concept_id, concept_label, f"Extracted from {GITHUB_USER} repos"))
                concepts_added += 1

            # Link concept to doc
            cursor.execute("""
                INSERT OR IGNORE INTO concept_mentions (id, concept_id, entity_type, entity_id, confidence)
                VALUES (?, ?, ?, ?, ?)
            """, (uid(), concept_id, "doc", doc_id, 0.8))

        conn.commit()
        print(f"  Done: {summary[:80]}...")
        print()

    # Mark sources as processed
    cursor.execute("UPDATE sources SET processed_at = datetime('now') WHERE host = 'github.com' AND processed_at IS NULL")
    conn.commit()

    print()
    print("=== Ingestion Complete ===")
    print(f"Sources added: {sources_added}")
    print(f"Docs processed: {docs_added}")
    print(f"Concepts created: {concepts_added}")

    # Show stats
    cursor.execute("SELECT COUNT(*) FROM sources")
    print(f"Total sources: {cursor.fetchone()[0]}")
    cursor.execute("SELECT COUNT(*) FROM docs")
    print(f"Total docs: {cursor.fetchone()[0]}")
    cursor.execute("SELECT COUNT(*) FROM concepts WHERE active = 1")
    print(f"Total concepts: {cursor.fetchone()[0]}")

    conn.close()


if __name__ == "__main__":
    main()
