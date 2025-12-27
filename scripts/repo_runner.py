#!/usr/bin/env python3
"""
Repo Runner - Clone, Install, Test Pipeline
Executes repository tests in a sandboxed environment with timeout handling.
"""

import json
import os
import shutil
import sqlite3
import subprocess
import tempfile
import signal
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, asdict
from contextlib import contextmanager
import threading

# Configuration
DB_PATH = os.environ.get("DATABASE_PATH", "/worktrees/afrog33k/dexter/data/ronald.db")
MAX_INSTALL_TIMEOUT = 120  # 2 minutes for install
MAX_TEST_TIMEOUT = 180     # 3 minutes for tests
MAX_OUTPUT_LENGTH = 50000  # 50KB max output capture
NETWORK_ISOLATED = os.environ.get("NETWORK_ISOLATED", "false").lower() == "true"


@dataclass
class RunResult:
    """Result of a repo run operation."""
    success: bool
    phase: str  # 'clone' | 'detect' | 'install' | 'test'
    exit_code: int
    stdout: str
    stderr: str
    duration_ms: int
    timed_out: bool = False
    error: Optional[str] = None


@dataclass
class TestReport:
    """Full test report for a repository."""
    url: str
    repo: str
    owner: str
    project_type: Optional[str]
    clone_result: Optional[RunResult]
    install_result: Optional[RunResult]
    test_result: Optional[RunResult]
    total_duration_ms: int
    passed: bool
    summary: str
    created_at: str


def uid() -> str:
    """Generate a unique ID."""
    import uuid
    return uuid.uuid4().hex


class TimeoutError(Exception):
    """Raised when operation times out."""
    pass


@contextmanager
def timeout(seconds: int):
    """Context manager for operation timeout."""
    def handler(signum, frame):
        raise TimeoutError(f"Operation timed out after {seconds}s")

    old_handler = signal.signal(signal.SIGALRM, handler)
    signal.alarm(seconds)
    try:
        yield
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, old_handler)


def run_command(
    cmd: List[str],
    cwd: str,
    timeout_seconds: int = 60,
    env: Optional[Dict] = None
) -> RunResult:
    """Run a command with timeout and output capture."""
    start = datetime.now()
    full_env = os.environ.copy()
    if env:
        full_env.update(env)

    # Add network isolation if enabled
    if NETWORK_ISOLATED and shutil.which("firejail"):
        cmd = ["firejail", "--net=none", "--quiet"] + cmd

    try:
        proc = subprocess.Popen(
            cmd,
            cwd=cwd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=full_env,
            text=True
        )

        stdout, stderr = proc.communicate(timeout=timeout_seconds)
        duration = int((datetime.now() - start).total_seconds() * 1000)

        return RunResult(
            success=proc.returncode == 0,
            phase="command",
            exit_code=proc.returncode,
            stdout=stdout[:MAX_OUTPUT_LENGTH],
            stderr=stderr[:MAX_OUTPUT_LENGTH],
            duration_ms=duration,
            timed_out=False
        )

    except subprocess.TimeoutExpired:
        proc.kill()
        stdout, stderr = proc.communicate()
        duration = int((datetime.now() - start).total_seconds() * 1000)

        return RunResult(
            success=False,
            phase="command",
            exit_code=-1,
            stdout=(stdout or "")[:MAX_OUTPUT_LENGTH],
            stderr=(stderr or "")[:MAX_OUTPUT_LENGTH],
            duration_ms=duration,
            timed_out=True,
            error=f"Timed out after {timeout_seconds}s"
        )

    except Exception as e:
        duration = int((datetime.now() - start).total_seconds() * 1000)
        return RunResult(
            success=False,
            phase="command",
            exit_code=-1,
            stdout="",
            stderr=str(e),
            duration_ms=duration,
            error=str(e)
        )


def detect_project_type(repo_path: str) -> Optional[str]:
    """Detect project type from files present."""
    files = set(os.listdir(repo_path))

    if "package.json" in files:
        # Check for specific package managers
        if "pnpm-lock.yaml" in files:
            return "pnpm"
        if "yarn.lock" in files:
            return "yarn"
        return "npm"

    if "pyproject.toml" in files or "setup.py" in files:
        if "poetry.lock" in files:
            return "poetry"
        if "Pipfile" in files:
            return "pipenv"
        return "pip"

    if "Cargo.toml" in files:
        return "cargo"

    if "go.mod" in files:
        return "go"

    if "Makefile" in files:
        return "make"

    return None


def get_install_command(project_type: str) -> List[str]:
    """Get install command for project type."""
    commands = {
        "npm": ["npm", "install", "--ignore-scripts"],
        "yarn": ["yarn", "install", "--ignore-scripts"],
        "pnpm": ["pnpm", "install", "--ignore-scripts"],
        "pip": ["pip", "install", "-e", ".", "--quiet"],
        "poetry": ["poetry", "install", "--no-interaction"],
        "pipenv": ["pipenv", "install", "--dev"],
        "cargo": ["cargo", "build", "--release"],
        "go": ["go", "build", "./..."],
        "make": ["make"],
    }
    return commands.get(project_type, [])


def get_test_command(project_type: str, repo_path: str) -> List[str]:
    """Get test command for project type."""
    # Check for custom test scripts in package.json
    if project_type in ["npm", "yarn", "pnpm"]:
        pkg_path = os.path.join(repo_path, "package.json")
        if os.path.exists(pkg_path):
            with open(pkg_path) as f:
                pkg = json.load(f)
                scripts = pkg.get("scripts", {})
                if "test" in scripts:
                    runner = {"npm": "npm", "yarn": "yarn", "pnpm": "pnpm"}[project_type]
                    return [runner, "test", "--", "--passWithNoTests"]

    commands = {
        "npm": ["npm", "test", "--", "--passWithNoTests"],
        "yarn": ["yarn", "test", "--passWithNoTests"],
        "pnpm": ["pnpm", "test", "--passWithNoTests"],
        "pip": ["pytest", "-v", "--tb=short", "-q"],
        "poetry": ["poetry", "run", "pytest", "-v", "--tb=short"],
        "pipenv": ["pipenv", "run", "pytest", "-v", "--tb=short"],
        "cargo": ["cargo", "test"],
        "go": ["go", "test", "./..."],
        "make": ["make", "test"],
    }
    return commands.get(project_type, [])


def clone_repo(url: str, dest: str) -> RunResult:
    """Clone repository with shallow depth."""
    return run_command(
        ["git", "clone", "--depth", "1", url, dest],
        cwd=os.path.dirname(dest),
        timeout_seconds=60
    )


def run_tests(url: str, owner: str, repo: str) -> TestReport:
    """Run full test pipeline for a repository."""
    start = datetime.now()
    temp_dir = tempfile.mkdtemp(prefix="ronald_test_")
    repo_path = os.path.join(temp_dir, repo)

    report = TestReport(
        url=url,
        repo=repo,
        owner=owner,
        project_type=None,
        clone_result=None,
        install_result=None,
        test_result=None,
        total_duration_ms=0,
        passed=False,
        summary="",
        created_at=datetime.now().isoformat()
    )

    try:
        # Phase 1: Clone
        print(f"  [1/4] Cloning {owner}/{repo}...")
        clone_result = clone_repo(url, repo_path)
        clone_result.phase = "clone"
        report.clone_result = clone_result

        if not clone_result.success:
            report.summary = f"Clone failed: {clone_result.error or clone_result.stderr[:200]}"
            return report

        # Phase 2: Detect project type
        print("  [2/4] Detecting project type...")
        project_type = detect_project_type(repo_path)
        report.project_type = project_type

        if not project_type:
            report.summary = "Could not detect project type"
            return report

        print(f"       Detected: {project_type}")

        # Phase 3: Install dependencies
        install_cmd = get_install_command(project_type)
        if install_cmd:
            print(f"  [3/4] Installing dependencies ({project_type})...")
            install_result = run_command(
                install_cmd,
                cwd=repo_path,
                timeout_seconds=MAX_INSTALL_TIMEOUT
            )
            install_result.phase = "install"
            report.install_result = install_result

            if not install_result.success and not install_result.timed_out:
                # Some projects don't have install, that's OK
                print(f"       Install warning: exit {install_result.exit_code}")

        # Phase 4: Run tests
        test_cmd = get_test_command(project_type, repo_path)
        if test_cmd:
            print(f"  [4/4] Running tests...")
            test_result = run_command(
                test_cmd,
                cwd=repo_path,
                timeout_seconds=MAX_TEST_TIMEOUT
            )
            test_result.phase = "test"
            report.test_result = test_result

            if test_result.timed_out:
                report.summary = f"Tests timed out after {MAX_TEST_TIMEOUT}s"
            elif test_result.success:
                report.passed = True
                report.summary = "All tests passed"
            else:
                # Try to extract test summary from output
                output = test_result.stdout + test_result.stderr
                if "FAILED" in output:
                    failed_count = output.count("FAILED")
                    report.summary = f"{failed_count} test(s) failed"
                else:
                    report.summary = f"Tests failed with exit code {test_result.exit_code}"
        else:
            report.summary = f"No test command for {project_type}"

    finally:
        # Cleanup
        shutil.rmtree(temp_dir, ignore_errors=True)
        report.total_duration_ms = int((datetime.now() - start).total_seconds() * 1000)

    return report


def store_report(report: TestReport) -> str:
    """Store test report in database."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Create test_runs table if not exists
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS test_runs (
            id TEXT PRIMARY KEY,
            url TEXT NOT NULL,
            owner TEXT NOT NULL,
            repo TEXT NOT NULL,
            project_type TEXT,
            passed INTEGER DEFAULT 0,
            summary TEXT,
            clone_result_json TEXT,
            install_result_json TEXT,
            test_result_json TEXT,
            total_duration_ms INTEGER,
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)

    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_test_runs_url ON test_runs(url)
    """)

    run_id = uid()
    cursor.execute("""
        INSERT INTO test_runs (
            id, url, owner, repo, project_type, passed, summary,
            clone_result_json, install_result_json, test_result_json,
            total_duration_ms, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        run_id,
        report.url,
        report.owner,
        report.repo,
        report.project_type,
        1 if report.passed else 0,
        report.summary,
        json.dumps(asdict(report.clone_result)) if report.clone_result else None,
        json.dumps(asdict(report.install_result)) if report.install_result else None,
        json.dumps(asdict(report.test_result)) if report.test_result else None,
        report.total_duration_ms,
        report.created_at
    ))

    conn.commit()
    conn.close()

    return run_id


def parse_github_url(url: str) -> Optional[Tuple[str, str]]:
    """Parse GitHub URL into (owner, repo)."""
    from urllib.parse import urlparse
    try:
        parsed = urlparse(url)
        if "github.com" not in parsed.netloc:
            return None
        parts = parsed.path.strip("/").split("/")
        if len(parts) >= 2:
            return (parts[0], parts[1].replace(".git", ""))
    except:
        pass
    return None


def should_run_tests(url: str, intensity: float = 0.0, uncertainty: float = 0.0) -> bool:
    """Gating logic: decide if we should run tests for this repo.

    Thresholds:
    - High intensity (>0.7) suggests user is deeply interested
    - High uncertainty (>0.5) suggests we need more signal
    - Always run for explicitly requested tests
    """
    # Parse to ensure it's a valid GitHub URL
    parsed = parse_github_url(url)
    if not parsed:
        return False

    # Gating thresholds
    INTENSITY_THRESHOLD = 0.7
    UNCERTAINTY_THRESHOLD = 0.5

    # Run if intensity is high (user is interested)
    if intensity >= INTENSITY_THRESHOLD:
        return True

    # Run if uncertainty is high (we need signal)
    if uncertainty >= UNCERTAINTY_THRESHOLD:
        return True

    return False


def run_for_source(source_id: str) -> Optional[TestReport]:
    """Run tests for a specific source ID."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM sources WHERE id = ?", (source_id,))
    source = cursor.fetchone()
    conn.close()

    if not source:
        print(f"Source not found: {source_id}")
        return None

    parsed = parse_github_url(source["url"])
    if not parsed:
        print(f"Not a GitHub URL: {source['url']}")
        return None

    owner, repo = parsed
    return run_tests(source["url"], owner, repo)


def main():
    import sys

    print("=== Repo Runner - Test Pipeline ===")
    print(f"Database: {DB_PATH}")
    print(f"Network isolation: {NETWORK_ISOLATED}")
    print()

    if len(sys.argv) > 1:
        url = sys.argv[1]

        parsed = parse_github_url(url)
        if not parsed:
            print("Error: Not a valid GitHub URL")
            sys.exit(1)

        owner, repo = parsed
        print(f"Running tests for: {owner}/{repo}")
        print()

        report = run_tests(url, owner, repo)

        print()
        print("=" * 50)
        print("TEST REPORT")
        print("=" * 50)
        print(f"Repository: {owner}/{repo}")
        print(f"Project type: {report.project_type or 'unknown'}")
        print(f"Duration: {report.total_duration_ms}ms")
        print(f"Passed: {'YES' if report.passed else 'NO'}")
        print(f"Summary: {report.summary}")

        if report.test_result:
            print()
            print("--- Test Output (last 500 chars) ---")
            output = (report.test_result.stdout + report.test_result.stderr)[-500:]
            print(output)

        # Store result
        run_id = store_report(report)
        print()
        print(f"Stored as run_id: {run_id}")

    else:
        print("Usage: python repo_runner.py <github_url>")
        print("Example: python repo_runner.py https://github.com/owner/repo")


if __name__ == "__main__":
    main()
