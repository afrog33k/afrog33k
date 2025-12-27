#!/usr/bin/env python3
"""
Re-ingest concepts using hybrid extraction: heuristics + optional LLM.
Cleans garbage concepts and fixes mention counts.
"""

import json
import sqlite3
import os
import re
from collections import Counter

DB_PATH = os.environ.get("DATABASE_PATH", "/worktrees/afrog33k/dexter/data/ronald.db")

# High-value technical terms to look for
TECH_TERMS = {
    # ML/AI
    'machine learning', 'deep learning', 'neural network', 'embeddings', 'vector embeddings',
    'transformer', 'attention mechanism', 'language model', 'nlp', 'natural language processing',
    'computer vision', 'image recognition', 'sentiment analysis', 'text classification',
    'knowledge graph', 'semantic search', 'recommendation system', 'reinforcement learning',

    # Data
    'data pipeline', 'data processing', 'data analysis', 'data visualization', 'data mining',
    'streaming data', 'batch processing', 'etl', 'data warehouse',

    # Web/API
    'rest api', 'graphql', 'websocket', 'microservices', 'serverless', 'api gateway',
    'authentication', 'authorization', 'oauth', 'jwt',

    # DevOps
    'docker', 'kubernetes', 'ci/cd', 'infrastructure as code', 'monitoring', 'logging',

    # Specific domains (Bricman)
    'knowledge management', 'personal knowledge base', 'spaced repetition', 'concept mapping',
    'semantic memory', 'cognitive tools', 'thought tools', 'idea management',
    'knowledge synthesis', 'information retrieval', 'content curation',

    # Coding patterns
    'functional programming', 'object oriented', 'design patterns', 'clean architecture',
    'test driven development', 'behavior driven development',
}

# Garbage words to filter
GARBAGE_WORDS = {
    'purpose', 'field', 'project', 'structure', 'systems', 'agenda', 'theme',
    'practical', 'installation', 'screenshots', 'usage', 'readme', 'contributors',
    'api', 'database', 'testing', 'metrics', 'unity', 'graph', 'analysis',
    'knowledge', 'technology', 'license', 'contributing', 'getting started',
    'requirements', 'features', 'overview', 'introduction', 'conclusion',
    # Additional garbage
    'background', 'method', 'description', 'examples', 'disclaimer', 'context',
    'from source', 'install with:', 'releases)', 'available scripts', 'process',
    'acknowledgements', 'general', 'themes', 'samples', 'experiments', 'example',
    'bare with me', 'in javascript', 'pour bac', 'un maraton',
}


def extract_concepts_heuristic(content: str, title: str, description: str) -> list:
    """Extract concepts using keyword matching and heuristics."""
    text = f"{title} {description} {content}".lower()
    concepts = []
    seen = set()

    # 1. Match against known tech terms
    for term in TECH_TERMS:
        if term in text and term not in seen:
            concepts.append(term)
            seen.add(term)

    # 2. Extract multi-word noun phrases from title/description
    for source in [title, description]:
        if not source:
            continue
        # Split on common separators
        phrases = re.split(r'[,.:;|/\-–—]', source.lower())
        for phrase in phrases:
            phrase = phrase.strip()
            # 2-4 words, no garbage
            words = phrase.split()
            if 2 <= len(words) <= 4:
                if phrase not in GARBAGE_WORDS and phrase not in seen:
                    if not any(w in GARBAGE_WORDS for w in words):
                        concepts.append(phrase)
                        seen.add(phrase)

    # 3. Extract key phrases from content headers (## headings)
    headers = re.findall(r'#+\s*([^\n]+)', content)
    for header in headers[:10]:
        header = header.lower().strip()
        if len(header) > 5 and len(header) < 40:
            if header not in GARBAGE_WORDS and header not in seen:
                words = header.split()
                if len(words) <= 4 and not any(w in GARBAGE_WORDS for w in words):
                    concepts.append(header)
                    seen.add(header)

    # 4. Repository-specific patterns
    repo_patterns = {
        'conceptarium': ['personal knowledge base', 'concept activation', 'knowledge management'],
        'ideoscope': ['idea visualization', 'thought mapping', 'concept exploration'],
        'lexiscore': ['text analysis', 'lexical scoring', 'writing metrics'],
        'decontextualizer': ['text extraction', 'context removal', 'content summarization'],
        'semantica': ['semantic analysis', 'meaning extraction', 'language understanding'],
        'memnav': ['memory navigation', 'knowledge retrieval', 'information access'],
        'dual': ['dual process', 'system integration', 'cognitive architecture'],
        'defensibility': ['security analysis', 'defense mechanisms', 'threat modeling'],
        'diotima': ['philosophical inquiry', 'socratic method', 'dialogue systems'],
        'cybersalience': ['attention modeling', 'salience detection', 'information filtering'],
        'k-probes': ['knowledge probing', 'model introspection', 'representation analysis'],
        'hypothesis': ['hypothesis generation', 'scientific reasoning', 'theory formation'],
        'ontology': ['ontology design', 'knowledge representation', 'semantic modeling'],
        'oneironomicon': ['dream analysis', 'symbolic interpretation', 'narrative generation'],
        'parrot': ['voice synthesis', 'text to speech', 'audio generation'],
        'prime-radiant': ['mathematical modeling', 'prime numbers', 'number theory'],
        'velma': ['question answering', 'knowledge retrieval', 'conversational ai'],
    }

    title_lower = title.lower()
    for key, terms in repo_patterns.items():
        if key in title_lower:
            for term in terms:
                if term not in seen:
                    concepts.append(term)
                    seen.add(term)

    # Filter and clean
    cleaned = []
    for c in concepts:
        c = c.strip()
        if len(c) < 5 or len(c) > 50:
            continue
        if c in GARBAGE_WORDS:
            continue
        cleaned.append(c)

    return cleaned[:5]


def uid() -> str:
    import uuid
    return uuid.uuid4().hex


def clean_garbage_concepts(conn: sqlite3.Connection) -> int:
    """Delete garbage concepts."""
    cursor = conn.cursor()
    deleted = 0

    cursor.execute("SELECT id, label FROM concepts WHERE active = 1")
    for row in cursor.fetchall():
        cid, label = row
        label_lower = label.lower()

        is_garbage = (
            label_lower in GARBAGE_WORDS or
            len(label) < 5 or
            len(label) > 50 or
            label_lower.startswith('concept') or
            '_' in label
        )

        if is_garbage:
            cursor.execute("DELETE FROM concept_mentions WHERE concept_id = ?", (cid,))
            cursor.execute("UPDATE concepts SET active = 0 WHERE id = ?", (cid,))
            deleted += 1

    conn.commit()
    return deleted


def fix_mention_counts(conn: sqlite3.Connection):
    """Update denormalized mention_count."""
    cursor = conn.cursor()
    cursor.execute("""
        UPDATE concepts SET mention_count = (
            SELECT COUNT(*) FROM concept_mentions WHERE concept_id = concepts.id
        )
    """)
    conn.commit()


def main():
    print("=" * 60)
    print("CONCEPT RE-INGESTION (Heuristic Mode)")
    print("=" * 60)

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Step 1: Clean garbage
    print("\n[1] Cleaning garbage concepts...")
    deleted = clean_garbage_concepts(conn)
    print(f"    Removed {deleted} garbage concepts")

    # Step 2: Get docs
    cursor.execute("""
        SELECT d.id, d.source_url, d.content, d.metadata_json
        FROM docs d WHERE d.source_type = 'repo_readme'
        ORDER BY d.created_at DESC
    """)
    docs = cursor.fetchall()
    print(f"\n[2] Processing {len(docs)} docs...")

    concepts_created = 0
    mentions_created = 0

    for i, doc in enumerate(docs):
        doc_id = doc["id"]
        meta = json.loads(doc["metadata_json"] or "{}")
        repo_name = meta.get("repo_name", "Unknown")
        description = meta.get("description", "")
        content = doc["content"] or ""

        # Clear existing mentions
        cursor.execute("""
            DELETE FROM concept_mentions WHERE entity_type = 'doc' AND entity_id = ?
        """, (doc_id,))

        # Extract concepts
        concepts = extract_concepts_heuristic(content, repo_name, description)

        if not concepts:
            continue

        print(f"  [{i+1}] {repo_name}: {concepts}")

        # Create/link concepts
        for concept_label in concepts:
            cursor.execute("SELECT id FROM concepts WHERE label = ?", (concept_label,))
            row = cursor.fetchone()

            if row:
                concept_id = row["id"]
                cursor.execute("UPDATE concepts SET active = 1 WHERE id = ?", (concept_id,))
            else:
                concept_id = uid()
                cursor.execute("""
                    INSERT INTO concepts (id, label, description, active)
                    VALUES (?, ?, ?, 1)
                """, (concept_id, concept_label, f"From {repo_name}"))
                concepts_created += 1

            cursor.execute("""
                INSERT INTO concept_mentions (id, concept_id, entity_type, entity_id, confidence)
                VALUES (?, ?, 'doc', ?, 0.9)
            """, (uid(), concept_id, doc_id))
            mentions_created += 1

        meta["concepts"] = concepts
        cursor.execute("UPDATE docs SET metadata_json = ? WHERE id = ?",
                       (json.dumps(meta), doc_id))
        conn.commit()

    # Step 3: Fix counts
    print("\n[3] Fixing mention counts...")
    fix_mention_counts(conn)

    # Results
    print("\n" + "=" * 60)
    print("RESULTS")
    print("=" * 60)

    cursor.execute("SELECT COUNT(*) FROM concepts WHERE active = 1")
    active = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM concept_mentions")
    mentions = cursor.fetchone()[0]

    cursor.execute("""
        SELECT label, mention_count FROM concepts
        WHERE active = 1 ORDER BY mention_count DESC LIMIT 30
    """)
    top = cursor.fetchall()

    print(f"New concepts: {concepts_created}")
    print(f"New mentions: {mentions_created}")
    print(f"Active concepts: {active}")
    print(f"Total mentions: {mentions}")
    print("\nTop 30 concepts by mentions:")
    for r in top:
        print(f"  {r['mention_count']:3d}  {r['label']}")

    conn.close()


if __name__ == "__main__":
    main()
