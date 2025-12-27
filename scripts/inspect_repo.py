#!/usr/bin/env python3
"""
Repo Inspect Modality
Clones, analyzes, and extracts signals from GitHub repositories.
"""

import json
import os
import shutil
import sqlite3
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any
from urllib.parse import urlparse

# Configuration
DB_PATH = os.environ.get("DATABASE_PATH", "/worktrees/afrog33k/dexter/data/ronald.db")
MAX_README_LENGTH = 4000
MAX_FILE_TREE_DEPTH = 3
SIGNAL_PATTERNS = {
    "has_tests": ["test/", "tests/", "__tests__/", "spec/", "pytest.ini", "jest.config"],
    "has_ci": [".github/workflows/", ".travis.yml", ".circleci/", "Jenkinsfile"],
    "has_docs": ["docs/", "documentation/", "doc/", "wiki/", "README.md"],
    "has_docker": ["Dockerfile", "docker-compose", "compose.yaml", ".dockerignore"],
    "is_python": ["setup.py", "pyproject.toml", "requirements.txt", "Pipfile"],
    "is_javascript": ["package.json", "yarn.lock", "pnpm-lock.yaml"],
    "is_rust": ["Cargo.toml", "Cargo.lock"],
    "is_go": ["go.mod", "go.sum"],
    "has_license": ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING"],
}


def uid() -> str:
    """Generate a unique ID."""
    import uuid
    return uuid.uuid4().hex


def parse_github_url(url: str) -> Optional[Dict[str, str]]:
    """Parse GitHub URL into owner and repo."""
    try:
        parsed = urlparse(url)
        if "github.com" not in parsed.netloc:
            return None
        parts = parsed.path.strip("/").split("/")
        if len(parts) >= 2:
            return {"owner": parts[0], "repo": parts[1].replace(".git", "")}
    except:
        pass
    return None


def clone_repo(url: str, dest: str, depth: int = 1) -> bool:
    """Clone a repository with shallow depth."""
    try:
        result = subprocess.run(
            ["git", "clone", "--depth", str(depth), url, dest],
            capture_output=True,
            timeout=60,
            text=True
        )
        return result.returncode == 0
    except Exception as e:
        print(f"  Clone error: {e}")
        return False


def get_file_tree(path: str, max_depth: int = MAX_FILE_TREE_DEPTH) -> List[str]:
    """Get file tree up to max depth."""
    files = []
    base = Path(path)

    def walk(current: Path, depth: int):
        if depth > max_depth:
            return
        try:
            for item in sorted(current.iterdir()):
                rel = item.relative_to(base)
                if item.name.startswith(".") and item.name != ".github":
                    continue
                if item.name in ["node_modules", "__pycache__", "venv", ".git", "dist", "build"]:
                    continue
                files.append(str(rel))
                if item.is_dir():
                    walk(item, depth + 1)
        except PermissionError:
            pass

    walk(base, 0)
    return files[:200]  # Limit to 200 files


def extract_readme(path: str) -> Optional[str]:
    """Extract README content."""
    for name in ["README.md", "readme.md", "README.rst", "README.txt", "README"]:
        readme_path = os.path.join(path, name)
        if os.path.exists(readme_path):
            try:
                with open(readme_path, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
                    return content[:MAX_README_LENGTH]
            except:
                pass
    return None


def detect_signals(file_tree: List[str]) -> Dict[str, bool]:
    """Detect repository signals from file tree."""
    signals = {}
    tree_str = "\n".join(file_tree).lower()

    for signal, patterns in SIGNAL_PATTERNS.items():
        signals[signal] = any(p.lower() in tree_str for p in patterns)

    return signals


def count_languages(file_tree: List[str]) -> Dict[str, int]:
    """Count files by extension."""
    extensions = {}
    for f in file_tree:
        ext = Path(f).suffix.lower()
        if ext:
            extensions[ext] = extensions.get(ext, 0) + 1
    return dict(sorted(extensions.items(), key=lambda x: -x[1])[:10])


def analyze_repo(url: str) -> Optional[Dict[str, Any]]:
    """Analyze a repository and return signals."""
    print(f"Analyzing: {url}")

    parsed = parse_github_url(url)
    if not parsed:
        print("  Not a valid GitHub URL")
        return None

    # Create temp directory
    temp_dir = tempfile.mkdtemp()
    repo_path = os.path.join(temp_dir, parsed["repo"])

    try:
        # Clone
        print("  Cloning (shallow)...")
        if not clone_repo(url, repo_path):
            print("  Clone failed")
            return None

        # Get file tree
        print("  Scanning file tree...")
        file_tree = get_file_tree(repo_path)
        print(f"  Found {len(file_tree)} files")

        # Extract README
        print("  Extracting README...")
        readme = extract_readme(repo_path)

        # Detect signals
        print("  Detecting signals...")
        signals = detect_signals(file_tree)

        # Count languages
        languages = count_languages(file_tree)

        result = {
            "url": url,
            "owner": parsed["owner"],
            "repo": parsed["repo"],
            "file_count": len(file_tree),
            "file_tree_sample": file_tree[:50],
            "readme_excerpt": readme,
            "signals": signals,
            "languages": languages,
            "analyzed_at": datetime.now().isoformat(),
        }

        # Calculate quality score
        quality = 0
        if signals.get("has_tests"): quality += 20
        if signals.get("has_ci"): quality += 15
        if signals.get("has_docs"): quality += 15
        if signals.get("has_license"): quality += 10
        if readme and len(readme) > 500: quality += 20
        if len(file_tree) > 10: quality += 10
        if len(languages) > 1: quality += 10
        result["quality_score"] = min(quality, 100)

        print(f"  Quality score: {result['quality_score']}/100")
        return result

    finally:
        # Cleanup
        shutil.rmtree(temp_dir, ignore_errors=True)


def inspect_pending_sources(limit: int = 10):
    """Inspect repos from pending sources."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Get GitHub sources not yet processed
    cursor.execute("""
        SELECT id, url, title
        FROM sources
        WHERE url LIKE '%github.com%'
          AND processed_at IS NULL
        ORDER BY priority DESC, created_at ASC
        LIMIT ?
    """, (limit,))

    sources = cursor.fetchall()
    print(f"Found {len(sources)} pending GitHub sources")

    for source in sources:
        result = analyze_repo(source["url"])

        if result:
            # Store as doc
            doc_id = uid()
            cursor.execute("""
                INSERT INTO docs (id, source_url, source_type, content, content_hash, metadata_json)
                VALUES (?, ?, 'repo_readme', ?, ?, ?)
            """, (
                doc_id,
                source["url"],
                result.get("readme_excerpt") or f"Repository: {result['repo']}",
                f"repo:{result['owner']}/{result['repo']}",
                json.dumps(result)
            ))

            # Mark source as processed
            cursor.execute("""
                UPDATE sources
                SET processed_at = datetime('now'),
                    updated_at = datetime('now')
                WHERE id = ?
            """, (source["id"],))

            conn.commit()
            print(f"  Stored analysis for {result['owner']}/{result['repo']}")

    conn.close()
    print(f"\nProcessed {len(sources)} repositories")


def main():
    import sys

    print("=== Repo Inspect Modality ===")
    print(f"Database: {DB_PATH}")
    print()

    if len(sys.argv) > 1:
        # Analyze specific URL
        url = sys.argv[1]
        result = analyze_repo(url)
        if result:
            print("\n" + "=" * 40)
            print("ANALYSIS RESULT")
            print("=" * 40)
            print(json.dumps(result, indent=2, default=str))
    else:
        # Process pending sources
        inspect_pending_sources()


if __name__ == "__main__":
    main()
