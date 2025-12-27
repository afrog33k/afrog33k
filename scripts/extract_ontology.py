#!/usr/bin/env python3
"""
Corpus-Based Ontology Extraction for Ronald-GI

Uses embeddings + NLP patterns to automatically discover:
1. Terms/concepts from the corpus
2. Hierarchical relationships (is-a)
3. Semantic relationships (related-to, uses, enables)
4. Concept clusters

References:
- KARMA: Multi-agent LLM for KG enrichment
- OntoKGen: Adaptive CoT ontology extraction
- spaCy-based term extraction patterns
"""

import json
import sqlite3
import os
import re
from collections import Counter, defaultdict
from urllib.request import urlopen, Request
import math

DB_PATH = os.environ.get("DATABASE_PATH", "/worktrees/afrog33k/dexter/data/ronald.db")
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")

# Stopwords for filtering
STOPWORDS = {
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
    'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during', 'before',
    'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then',
    'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
    'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only',
    'own', 'same', 'so', 'than', 'too', 'very', 'just', 'can', 'will', 'should',
    'now', 'also', 'as', 'if', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'this', 'that', 'these', 'those',
    'it', 'its', 'you', 'your', 'we', 'our', 'they', 'them', 'their', 'what',
    'which', 'who', 'whom', 'would', 'could', 'may', 'might', 'must', 'shall',
    # Technical stopwords
    'use', 'using', 'used', 'uses', 'run', 'running', 'make', 'making',
    'get', 'getting', 'set', 'setting', 'see', 'seeing', 'add', 'adding',
    'file', 'files', 'folder', 'example', 'examples', 'note', 'notes',
    'step', 'steps', 'install', 'installation', 'setup', 'usage',
    'readme', 'license', 'contributing', 'contributors', 'requirements',
    'user', 'users', 'project', 'projects', 'creating', 'write-up',
}

# Noise patterns to filter out (package names, commands, etc.)
NOISE_PATTERNS = [
    r'^python-',  # python-* packages
    r'^create-react-app',
    r'^docker-compose',
    r'^gatsby-',
    r'^npm-',
    r'^apt-get',
    r'^pip-',
    r'^git-',
    r'-images$',
    r'^my-',
    r'^new-',
    r'^cpp-',
    r'^bash-',
    r'^user-',
    r'-config$',
    r'-starter-',
    r'\d{2,}',  # Contains 2+ digit numbers
    # Code artifacts
    r'^package-',
    r'^node$',
    r'^npm$',
    r'^i in',
    r'^fast download',
    r'^outside',
    r'-lock$',
    r'^third-',
    r'^one-to-',
    r'^mapping pixel',
    r'^color$',
    r'^number$',
    r'^vectors$',
    r'^information$',
    r'^ground-',
    r'^follow-',
    r'^of-the-',
    r'^all-in-',
    r'^self',
    # More noise
    r'^keras$',
    r'^tensorflow',
    r'^pytorch',
    r'^simple$',
    r'^front-',
    r'^back-',
    r'^vox-',
    r'^cluj',
    r'^homogeneous',
    r'^following',
    r'^multiple\s+plot',
    r'^one-liner',
    r'^food\s+for',
    r'-cdn$',
    r'^news\s+outlets',
    r'^text\s+mining',
]

# High-value domain terms (Bricman cognitive tools domain)
DOMAIN_TERMS = {
    # Core cognitive/knowledge concepts
    'knowledge management', 'knowledge graph', 'knowledge base', 'knowledge representation',
    'concept map', 'concept mapping', 'conceptual model', 'mental model',
    'semantic memory', 'semantic search', 'semantic similarity',
    'spaced repetition', 'active recall', 'memory consolidation',
    'thought tools', 'cognitive tools', 'thinking tools',
    'idea management', 'idea synthesis', 'ideation',
    'ontology', 'taxonomy', 'hierarchy',
    # AI/ML concepts
    'machine learning', 'deep learning', 'neural network', 'transformer',
    'language model', 'embeddings', 'vector space', 'attention mechanism',
    'natural language processing', 'text classification', 'sentiment analysis',
    'information retrieval', 'question answering', 'text generation',
    'reinforcement learning', 'computer vision', 'image recognition',
    # Specific tools/methods
    'knowledge graph embedding', 'entity extraction', 'relation extraction',
    'text summarization', 'content curation', 'information filtering',
    'collaborative filtering', 'recommendation system',
}

# Patterns for noun phrase extraction
NP_PATTERNS = [
    # Adjective + Noun combinations
    r'\b([a-z]+(?:\s+[a-z]+){1,3})\b(?:\s+(?:system|model|algorithm|network|learning|processing|analysis|extraction|generation|management|architecture|framework|tool|library|method|approach|technique))',
    # Compound nouns
    r'\b([a-z]+[-\s][a-z]+(?:[-\s][a-z]+)?)\b',
]

# Relationship patterns (X relation Y)
RELATION_PATTERNS = [
    # Hypernym (is-a)
    (r'(\b\w+(?:\s+\w+)?\b)\s+is\s+(?:a|an)\s+(?:type\s+of\s+)?(\b\w+(?:\s+\w+)?\b)', 'is_a'),
    (r'(\b\w+(?:\s+\w+)?\b)\s+(?:are|is)\s+(?:a\s+)?(?:kind|form|type)\s+of\s+(\b\w+(?:\s+\w+)?\b)', 'is_a'),
    # Uses/enables
    (r'(\b\w+(?:\s+\w+)?\b)\s+(?:uses?|utilizes?|leverages?)\s+(\b\w+(?:\s+\w+)?\b)', 'uses'),
    (r'(\b\w+(?:\s+\w+)?\b)\s+(?:enables?|allows?|supports?)\s+(\b\w+(?:\s+\w+)?\b)', 'enables'),
    # Part-of
    (r'(\b\w+(?:\s+\w+)?\b)\s+(?:is\s+)?(?:part\s+of|component\s+of)\s+(\b\w+(?:\s+\w+)?\b)', 'part_of'),
    # Related-to
    (r'(\b\w+(?:\s+\w+)?\b)\s+(?:is\s+)?(?:related\s+to|similar\s+to|based\s+on)\s+(\b\w+(?:\s+\w+)?\b)', 'related_to'),
]


def extract_noun_phrases(text: str) -> list:
    """Extract candidate noun phrases from text."""
    text = text.lower()
    candidates = []

    # Method 0: Match against high-value domain terms
    for term in DOMAIN_TERMS:
        if term in text:
            candidates.append(term)

    # Method 1: Look for known technical patterns
    tech_patterns = [
        r'(?:machine|deep|reinforcement)\s+learning',
        r'(?:neural|convolutional|recurrent)\s+network(?:s)?',
        r'(?:natural\s+)?language\s+(?:processing|model|understanding)',
        r'(?:knowledge|concept)\s+(?:graph|base|management|representation)',
        r'(?:semantic|vector|word)\s+(?:search|embedding|similarity)',
        r'(?:sentiment|text)\s+(?:analysis|classification|mining)',
        r'(?:computer|machine)\s+vision',
        r'(?:information|data)\s+(?:retrieval|extraction|processing)',
        r'(?:content|text)\s+(?:summarization|generation)',
        r'(?:entity|relation)\s+(?:extraction|recognition)',
        r'(?:question|dialogue)\s+(?:answering|system)',
        r'(?:spaced|active)\s+(?:repetition|recall)',
        r'(?:cognitive|thought|thinking)\s+(?:tools?|architecture)',
        r'(?:idea|concept)\s+(?:management|synthesis|mapping)',
        r'(?:mental|conceptual)\s+(?:model|map)',
    ]

    for pattern in tech_patterns:
        matches = re.findall(pattern, text)
        candidates.extend(matches)

    # Method 2: Extract capitalized multi-word terms (likely proper nouns/concepts)
    cap_pattern = r'\b([A-Z][a-z]+(?:\s+[A-Z]?[a-z]+){1,3})\b'
    for match in re.findall(cap_pattern, text):
        if len(match) > 3 and match.lower() not in STOPWORDS:
            candidates.append(match.lower())

    # Method 3: Extract hyphenated compounds
    hyphen_pattern = r'\b([a-z]+-[a-z]+(?:-[a-z]+)?)\b'
    for match in re.findall(hyphen_pattern, text):
        if len(match) > 5:
            candidates.append(match)

    # Method 4: Extract terms near technical keywords
    context_pattern = r'(?:using|with|for|via|through)\s+([a-z]+(?:\s+[a-z]+){0,2})'
    for match in re.findall(context_pattern, text):
        if len(match) > 3 and match not in STOPWORDS:
            candidates.append(match)

    return candidates


def clean_term(term: str) -> str:
    """Clean and normalize a term."""
    term = term.strip().lower()

    # Check noise patterns
    for pattern in NOISE_PATTERNS:
        if re.search(pattern, term):
            return ""

    # Remove leading/trailing stopwords
    words = term.split()
    while words and words[0] in STOPWORDS:
        words.pop(0)
    while words and words[-1] in STOPWORDS:
        words.pop()

    return ' '.join(words)


def extract_relationships(text: str) -> list:
    """Extract semantic relationships from text."""
    text = text.lower()
    relations = []

    for pattern, rel_type in RELATION_PATTERNS:
        matches = re.findall(pattern, text)
        for match in matches:
            if len(match) == 2:
                subj = clean_term(match[0])
                obj = clean_term(match[1])
                if subj and obj and subj != obj:
                    if len(subj) > 2 and len(obj) > 2:
                        relations.append((subj, rel_type, obj))

    return relations


def get_embedding(text: str) -> list:
    """Get embedding vector from Ollama."""
    payload = json.dumps({
        "model": "nomic-embed-text",
        "input": text
    }).encode()

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
        return []


def cosine_similarity(v1: list, v2: list) -> float:
    """Calculate cosine similarity between two vectors."""
    if not v1 or not v2 or len(v1) != len(v2):
        return 0.0

    dot = sum(a * b for a, b in zip(v1, v2))
    norm1 = math.sqrt(sum(a * a for a in v1))
    norm2 = math.sqrt(sum(b * b for b in v2))

    if norm1 == 0 or norm2 == 0:
        return 0.0

    return dot / (norm1 * norm2)


def cluster_terms(terms: list, threshold: float = 0.75) -> list:
    """Cluster similar terms using embeddings."""
    if not terms:
        return []

    # Get embeddings for all terms
    print(f"  Getting embeddings for {len(terms)} terms...")
    term_embeddings = {}
    for term in terms[:100]:  # Limit for performance
        emb = get_embedding(term)
        if emb:
            term_embeddings[term] = emb

    # Build clusters
    clusters = []
    used = set()

    for term, emb in term_embeddings.items():
        if term in used:
            continue

        cluster = [term]
        used.add(term)

        for other, other_emb in term_embeddings.items():
            if other in used:
                continue
            sim = cosine_similarity(emb, other_emb)
            if sim >= threshold:
                cluster.append(other)
                used.add(other)

        if len(cluster) > 1:
            clusters.append(cluster)

    return clusters


def build_cooccurrence_graph(docs: list) -> dict:
    """Build co-occurrence graph from documents."""
    cooccurrence = defaultdict(Counter)

    for doc in docs:
        content = doc.get("content", "")
        terms = extract_noun_phrases(content)
        terms = [clean_term(t) for t in terms if t]
        terms = [t for t in terms if len(t) > 3]

        # Count co-occurrences within same document
        for i, t1 in enumerate(terms):
            for t2 in terms[i+1:]:
                if t1 != t2:
                    cooccurrence[t1][t2] += 1
                    cooccurrence[t2][t1] += 1

    return cooccurrence


def uid() -> str:
    import uuid
    return uuid.uuid4().hex


def main():
    print("=" * 70)
    print("CORPUS-BASED ONTOLOGY EXTRACTION")
    print("=" * 70)

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Get all docs
    cursor.execute("""
        SELECT d.id, d.content, d.metadata_json
        FROM docs d WHERE d.source_type = 'repo_readme'
    """)
    docs = [dict(row) for row in cursor.fetchall()]
    print(f"\nProcessing {len(docs)} documents...")

    # Step 1: Extract all candidate terms
    print("\n[1] Extracting candidate terms...")
    all_terms = Counter()
    doc_terms = {}

    for doc in docs:
        content = doc.get("content", "")
        meta = json.loads(doc.get("metadata_json") or "{}")
        repo_name = meta.get("repo_name", "")
        description = meta.get("description", "")

        # Combine sources
        full_text = f"{repo_name} {description} {content}"
        terms = extract_noun_phrases(full_text)
        terms = [clean_term(t) for t in terms if t]
        terms = [t for t in terms if len(t) > 3 and t not in STOPWORDS]

        doc_terms[doc["id"]] = terms
        all_terms.update(terms)

    print(f"    Found {len(all_terms)} unique terms")

    # Step 2: Filter to significant terms (appear in multiple docs)
    print("\n[2] Filtering to significant terms...")
    significant = {term: count for term, count in all_terms.items()
                   if count >= 2 or len(term.split()) >= 2}
    print(f"    {len(significant)} significant terms")

    # Step 3: Extract relationships
    print("\n[3] Extracting relationships...")
    all_relations = []
    for doc in docs:
        content = doc.get("content", "")
        rels = extract_relationships(content)
        all_relations.extend(rels)

    # Count relation frequency
    rel_counter = Counter(all_relations)
    print(f"    Found {len(rel_counter)} unique relationships")

    # Step 4: Cluster similar terms
    print("\n[4] Clustering similar terms...")
    top_terms = [t for t, c in all_terms.most_common(80)]
    clusters = cluster_terms(top_terms, threshold=0.70)
    print(f"    Found {len(clusters)} clusters")

    # Step 5: Build ontology
    print("\n[5] Building ontology...")

    # Clear existing concepts and mentions
    cursor.execute("UPDATE concepts SET active = 0")
    cursor.execute("DELETE FROM concept_mentions")
    conn.commit()

    concepts_created = 0
    mentions_created = 0
    relations_created = 0

    # Create concepts from significant terms
    concept_map = {}  # term -> concept_id

    for term, count in significant.items():
        if len(term) < 4:
            continue

        # Check if concept already exists
        cursor.execute("SELECT id FROM concepts WHERE label = ?", (term,))
        existing = cursor.fetchone()

        if existing:
            concept_id = existing["id"]
            cursor.execute("""
                UPDATE concepts SET active = 1, description = ?, mention_count = ?
                WHERE id = ?
            """, (f"Extracted from corpus (count: {count})", count, concept_id))
        else:
            concept_id = uid()
            cursor.execute("""
                INSERT INTO concepts (id, label, description, mention_count, active)
                VALUES (?, ?, ?, ?, 1)
            """, (concept_id, term, f"Extracted from corpus (count: {count})", count))
            concepts_created += 1

        concept_map[term] = concept_id

    # Create mentions linking concepts to docs
    for doc_id, terms in doc_terms.items():
        for term in terms:
            if term in concept_map:
                cursor.execute("""
                    INSERT INTO concept_mentions (id, concept_id, entity_type, entity_id, confidence)
                    VALUES (?, ?, 'doc', ?, 0.8)
                """, (uid(), concept_map[term], doc_id))
                mentions_created += 1

    conn.commit()

    # Step 6: Store cluster information
    print("\n[6] Storing concept clusters...")
    for i, cluster in enumerate(clusters):
        if len(cluster) < 2:
            continue
        # Use first term as cluster representative
        rep = cluster[0]
        if rep in concept_map:
            cursor.execute("""
                UPDATE concepts SET description = ? WHERE id = ?
            """, (f"Cluster: {', '.join(cluster[:5])}", concept_map[rep]))

    conn.commit()

    # Fix mention counts
    cursor.execute("""
        UPDATE concepts SET mention_count = (
            SELECT COUNT(*) FROM concept_mentions WHERE concept_id = concepts.id
        )
    """)
    conn.commit()

    # Results
    print("\n" + "=" * 70)
    print("ONTOLOGY EXTRACTION RESULTS")
    print("=" * 70)

    cursor.execute("SELECT COUNT(*) FROM concepts WHERE active = 1")
    active = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM concept_mentions")
    mentions = cursor.fetchone()[0]

    print(f"Concepts created: {concepts_created}")
    print(f"Mentions created: {mentions_created}")
    print(f"Active concepts: {active}")
    print(f"Total mentions: {mentions}")

    print("\nTop 30 concepts by document frequency:")
    cursor.execute("""
        SELECT label, mention_count FROM concepts
        WHERE active = 1 ORDER BY mention_count DESC LIMIT 30
    """)
    for row in cursor.fetchall():
        print(f"  {row['mention_count']:3d}  {row['label']}")

    print("\nConcept clusters found:")
    for cluster in clusters[:10]:
        print(f"  • {cluster[0]}: {', '.join(cluster[1:5])}")

    print("\nTop relationships extracted:")
    for (subj, rel, obj), count in rel_counter.most_common(15):
        print(f"  {subj} --[{rel}]--> {obj} ({count})")

    conn.close()

    # Sources
    print("\n" + "=" * 70)
    print("Approach based on:")
    print("  • KARMA: Multi-agent LLM KG enrichment")
    print("  • OntoKGen: Adaptive CoT ontology extraction")
    print("  • fusion-jena/automatic-KG-creation-with-LLM")
    print("=" * 70)


if __name__ == "__main__":
    main()
