#!/usr/bin/env python3
"""
Generate seed reports from paulbricman repos for Ronald-GI
"""

import json
import sqlite3
import os
from urllib.request import urlopen, Request

# Configuration
DB_PATH = os.environ.get("DATABASE_PATH", "/worktrees/afrog33k/dexter/data/ronald.db")
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen3:0.6b")


def generate_with_ollama(prompt: str, system: str = None, temperature: float = 0.3) -> str:
    """Generate text with Ollama."""
    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": temperature, "num_predict": 500}
    }
    if system:
        payload["system"] = system

    req = Request(
        f"{OLLAMA_URL}/api/generate",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    with urlopen(req, timeout=60) as resp:
        return json.loads(resp.read()).get("response", "")


def uid() -> str:
    import uuid
    return uuid.uuid4().hex


def main():
    print("=== Generating Seed Reports from Bricman Repos ===")
    print()

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Get top repos by interest (those with most concepts)
    cursor.execute("""
        SELECT d.id, d.source_url, d.metadata_json, d.content
        FROM docs d
        WHERE d.source_type = 'repo_readme'
        ORDER BY d.created_at DESC
        LIMIT 10
    """)

    docs = cursor.fetchall()
    print(f"Processing {len(docs)} documents...")
    print()

    reports_created = 0

    for doc in docs:
        meta = json.loads(doc["metadata_json"])
        repo_name = meta.get("repo_name", "Unknown")
        summary = meta.get("summary", "")
        concepts = meta.get("concepts", [])
        stars = meta.get("stars", 0)
        content = doc["content"][:3000]

        print(f"Generating report for: {repo_name}")

        # Generate a research brief
        system_prompt = """You are Ronald-GI, an autonomous research colleague.
Your tone is direct, calm, and judgment-forward. You speak as a colleague, never as a boss.
Generate a structured research brief about this repository."""

        prompt = f"""Analyze this repository and create a research brief.

Repository: {repo_name}
URL: {doc['source_url']}
Stars: {stars}
Summary: {summary}
Concepts: {', '.join(concepts)}

README excerpt:
{content}

Generate a JSON response with:
- title: A clear title (max 60 chars)
- summary: 1-2 sentence summary
- findings: List of 3-4 key findings
- decision: Recommendation (e.g., "Worth exploring", "Integrate into workflow", "Reference for later")
- impact_score: 0.0-1.0 based on utility
- novelty_score: 0.0-1.0 based on uniqueness
- relevance_score: 0.0-1.0 based on fit to cognitive tools/AI themes

JSON only:"""

        try:
            response = generate_with_ollama(prompt, system_prompt)

            # Extract JSON
            import re
            match = re.search(r'\{.*\}', response, re.DOTALL)
            if match:
                report_data = json.loads(match.group())
            else:
                print(f"  Could not parse response, skipping")
                continue

            # Calculate blended score
            impact = min(max(float(report_data.get("impact_score", 0.5)), 0), 1)
            novelty = min(max(float(report_data.get("novelty_score", 0.5)), 0), 1)
            relevance = min(max(float(report_data.get("relevance_score", 0.5)), 0), 1)

            blended = 0.45 * impact + 0.45 * novelty + 0.10 * relevance
            promoted = 1 if blended > 0.4 else 0

            report_id = uid()
            cursor.execute("""
                INSERT INTO reports (
                    id, type, title, summary, findings_json, decision,
                    evidence_json, ui_blocks_json, concept_ids_json,
                    impact_score, novelty_score, relevance_score, promoted
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                report_id,
                "repo_signal",
                report_data.get("title", f"Report: {repo_name}")[:80],
                report_data.get("summary", summary)[:500],
                json.dumps(report_data.get("findings", [])),
                report_data.get("decision"),
                json.dumps([{"url": doc["source_url"], "title": repo_name}]),
                json.dumps([]),
                json.dumps([]),
                impact,
                novelty,
                relevance,
                promoted
            ))

            # Link concepts
            for concept_label in concepts[:5]:
                cursor.execute("SELECT id FROM concepts WHERE label = ?", (concept_label.lower(),))
                row = cursor.fetchone()
                if row:
                    cursor.execute("""
                        INSERT OR IGNORE INTO concept_mentions (id, concept_id, entity_type, entity_id, confidence)
                        VALUES (?, ?, ?, ?, ?)
                    """, (uid(), row["id"], "report", report_id, 0.9))

            conn.commit()
            reports_created += 1
            print(f"  Created: {report_data.get('title', repo_name)[:50]}...")
            print(f"  Scores: impact={impact:.2f}, novelty={novelty:.2f}, blended={blended:.2f}")
            print()

        except Exception as e:
            print(f"  Error: {e}")
            continue

    print()
    print(f"=== Generated {reports_created} Reports ===")

    # Show stats
    cursor.execute("SELECT COUNT(*) FROM reports")
    print(f"Total reports: {cursor.fetchone()[0]}")

    cursor.execute("SELECT COUNT(*) FROM reports WHERE promoted = 1")
    print(f"Promoted reports: {cursor.fetchone()[0]}")

    conn.close()


if __name__ == "__main__":
    main()
