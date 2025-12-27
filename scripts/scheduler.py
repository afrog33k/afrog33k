#!/usr/bin/env python3
"""
Ronald-GI Scheduler

Runs the ingestion and processing pipeline on a schedule:
- Every hour: HackerNews (GitHub filter), Twitter monitoring
- Every 6 hours: Full HN scan, concept evolution
- Daily: World model update, digest generation

Usage:
    python scripts/scheduler.py                    # Run as daemon
    python scripts/scheduler.py --once            # Run all tasks once
    python scripts/scheduler.py --task hourly     # Run specific task
"""

import argparse
import subprocess
import sqlite3
import json
import time
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

SCRIPTS_DIR = Path(__file__).parent
DB_PATH = SCRIPTS_DIR.parent / "data" / "ronald.db"
LOG_DIR = SCRIPTS_DIR.parent / "data" / "logs"

# Task definitions
TASKS = {
    "hourly": {
        "interval_minutes": 60,
        "scripts": [
            ("ingest_hackernews.py", ["--filter", "github", "--limit", "30", "--create-jobs"]),
            ("ingest_xcancel.py", ["--limit", "20"]),
        ],
    },
    "every_6h": {
        "interval_minutes": 360,
        "scripts": [
            ("ingest_hackernews.py", ["--filter", "all", "--limit", "100", "--create-jobs"]),
            ("evolve_worldmodel.py", []),
        ],
    },
    "daily": {
        "interval_minutes": 1440,
        "scripts": [
            ("extract_ontology.py", []),
            ("compute_nearest.py", []),
            ("cluster_visits.py", []),
        ],
    },
}


def get_db():
    """Get database connection."""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def ensure_scheduler_table(conn: sqlite3.Connection):
    """Create scheduler tracking table."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS scheduler_runs (
            task_name TEXT PRIMARY KEY,
            last_run TEXT,
            next_run TEXT,
            last_status TEXT,
            last_duration_seconds REAL
        )
    """)
    conn.commit()


def get_last_run(conn: sqlite3.Connection, task_name: str) -> Optional[datetime]:
    """Get last run time for a task."""
    row = conn.execute(
        "SELECT last_run FROM scheduler_runs WHERE task_name = ?",
        (task_name,)
    ).fetchone()
    if row and row["last_run"]:
        return datetime.fromisoformat(row["last_run"])
    return None


def update_run(conn: sqlite3.Connection, task_name: str, status: str, duration: float):
    """Update run status."""
    task_config = TASKS.get(task_name, {})
    interval = task_config.get("interval_minutes", 60)
    next_run = datetime.now() + timedelta(minutes=interval)

    conn.execute("""
        INSERT OR REPLACE INTO scheduler_runs (task_name, last_run, next_run, last_status, last_duration_seconds)
        VALUES (?, datetime('now'), ?, ?, ?)
    """, (task_name, next_run.isoformat(), status, duration))
    conn.commit()


def run_script(script_name: str, args: list) -> tuple[bool, str]:
    """Run a Python script and return success status and output."""
    script_path = SCRIPTS_DIR / script_name
    if not script_path.exists():
        return False, f"Script not found: {script_path}"

    cmd = [sys.executable, str(script_path)] + args

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300,  # 5 minute timeout
            cwd=str(SCRIPTS_DIR.parent),
        )
        output = result.stdout + result.stderr
        return result.returncode == 0, output
    except subprocess.TimeoutExpired:
        return False, "Script timed out"
    except Exception as e:
        return False, str(e)


def run_task(task_name: str, force: bool = False) -> bool:
    """Run a scheduled task if due."""
    if task_name not in TASKS:
        print(f"Unknown task: {task_name}")
        return False

    conn = get_db()
    ensure_scheduler_table(conn)

    task_config = TASKS[task_name]
    interval = task_config["interval_minutes"]
    last_run = get_last_run(conn, task_name)

    # Check if task is due
    if not force and last_run:
        next_due = last_run + timedelta(minutes=interval)
        if datetime.now() < next_due:
            minutes_left = (next_due - datetime.now()).total_seconds() / 60
            print(f"  [{task_name}] Not due yet ({minutes_left:.0f} min remaining)")
            return True

    print(f"\n[{datetime.now().isoformat()}] Running task: {task_name}")
    start_time = time.time()
    all_success = True

    for script_name, script_args in task_config["scripts"]:
        print(f"  Running {script_name}...")
        success, output = run_script(script_name, script_args)

        if success:
            print(f"    ✓ {script_name} completed")
        else:
            print(f"    ✗ {script_name} failed")
            print(f"      {output[:500]}")
            all_success = False

        # Log output
        log_file = LOG_DIR / f"{script_name.replace('.py', '')}.log"
        LOG_DIR.mkdir(exist_ok=True)
        with open(log_file, "a") as f:
            f.write(f"\n[{datetime.now().isoformat()}]\n{output}\n")

    duration = time.time() - start_time
    status = "success" if all_success else "partial_failure"
    update_run(conn, task_name, status, duration)
    conn.close()

    print(f"  Task {task_name} completed in {duration:.1f}s ({status})")
    return all_success


def run_all_tasks(force: bool = False):
    """Run all tasks that are due."""
    print(f"[{datetime.now().isoformat()}] Scheduler check")
    for task_name in TASKS:
        run_task(task_name, force=force)


def daemon_loop():
    """Run as a daemon, checking every minute."""
    print(f"[{datetime.now().isoformat()}] Starting Ronald-GI scheduler daemon")
    print(f"  Tasks: {', '.join(TASKS.keys())}")
    print(f"  Database: {DB_PATH}")
    print(f"  Press Ctrl+C to stop\n")

    while True:
        try:
            run_all_tasks()
            time.sleep(60)  # Check every minute
        except KeyboardInterrupt:
            print("\n\nScheduler stopped.")
            break
        except Exception as e:
            print(f"Error in scheduler: {e}")
            time.sleep(60)


def show_status():
    """Show scheduler status."""
    conn = get_db()
    ensure_scheduler_table(conn)

    print("\n📅 Ronald-GI Scheduler Status")
    print("=" * 50)

    for task_name, config in TASKS.items():
        row = conn.execute(
            "SELECT * FROM scheduler_runs WHERE task_name = ?",
            (task_name,)
        ).fetchone()

        print(f"\n{task_name} (every {config['interval_minutes']} min)")
        if row:
            print(f"  Last run: {row['last_run']}")
            print(f"  Next run: {row['next_run']}")
            print(f"  Status: {row['last_status']}")
            print(f"  Duration: {row['last_duration_seconds']:.1f}s")
        else:
            print("  Never run")

        print(f"  Scripts: {', '.join(s[0] for s in config['scripts'])}")

    conn.close()


def main():
    parser = argparse.ArgumentParser(description="Ronald-GI Scheduler")
    parser.add_argument("--once", action="store_true",
                       help="Run all tasks once and exit")
    parser.add_argument("--task", type=str, choices=list(TASKS.keys()),
                       help="Run a specific task")
    parser.add_argument("--force", action="store_true",
                       help="Force run even if not due")
    parser.add_argument("--status", action="store_true",
                       help="Show scheduler status")
    args = parser.parse_args()

    if args.status:
        show_status()
    elif args.task:
        run_task(args.task, force=args.force)
    elif args.once:
        run_all_tasks(force=True)
    else:
        daemon_loop()


if __name__ == "__main__":
    main()
