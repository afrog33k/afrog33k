#!/usr/bin/env python3
"""
Ambient Capture Daemon for Ronald-GI

Runs in the background, watches what you're doing, and proactively helps:

1. SCREEN CONTEXT: Tracks active window/app to understand current task
2. CLIPBOARD: Monitors clipboard for URLs, code, terms you're researching
3. AUDIO/MEETINGS: (Optional) Transcribes meetings to extract action items
4. ANTICIPATION: "You seem to be working on X, here's 5 things that might help"

Designed for INTJ/ADHD minds:
- Non-intrusive (no popups, just quiet background work)
- Proactive (surfaces help before you ask)
- Memory augmentation (remembers what you forget)

Usage:
    python scripts/ambient_capture.py                    # Run daemon
    python scripts/ambient_capture.py --status          # Show current context
    python scripts/ambient_capture.py --suggestions     # Get proactive suggestions

Requirements (macOS):
    pip install pyobjc-framework-Cocoa pyobjc-framework-Quartz
"""

import argparse
import sqlite3
import json
import re
import time
import hashlib
import subprocess
import threading
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse
from typing import Dict, List, Optional, Any
from collections import defaultdict

# Optional imports
try:
    from AppKit import NSWorkspace, NSPasteboard
    HAS_APPKIT = True
except ImportError:
    HAS_APPKIT = False

try:
    import whisper
    HAS_WHISPER = False  # Disabled by default, enable if you want audio
except ImportError:
    HAS_WHISPER = False

DB_PATH = Path(__file__).parent.parent / "data" / "ronald.db"

# Context detection patterns
WORK_CONTEXTS = {
    'coding': {
        'apps': ['Code', 'Visual Studio', 'Xcode', 'IntelliJ', 'PyCharm', 'Terminal', 'iTerm'],
        'keywords': ['function', 'class', 'import', 'def', 'const', 'var', 'let'],
    },
    'research': {
        'apps': ['Safari', 'Chrome', 'Firefox', 'Arc'],
        'keywords': ['paper', 'arxiv', 'github', 'documentation', 'tutorial'],
    },
    'writing': {
        'apps': ['Notion', 'Obsidian', 'Bear', 'Notes', 'Word', 'Pages', 'Typora'],
        'keywords': ['draft', 'document', 'notes'],
    },
    'meeting': {
        'apps': ['Zoom', 'Teams', 'Meet', 'Slack', 'Discord'],
        'keywords': ['call', 'meeting', 'standup'],
    },
    'reading': {
        'apps': ['Preview', 'PDF', 'Kindle', 'Books'],
        'keywords': ['reading', 'book', 'paper'],
    },
}


def get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def random_id() -> str:
    return hashlib.sha256(str(time.time()).encode()).hexdigest()[:16]


class AmbientCapture:
    """Main ambient capture daemon."""

    def __init__(self, verbose: bool = False):
        self.verbose = verbose
        self.current_context: Dict[str, Any] = {}
        self.context_history: List[Dict] = []
        self.clipboard_history: List[str] = []
        self.last_clipboard = ""
        self.running = True

        self.ensure_tables()

    def ensure_tables(self):
        """Create ambient capture tables."""
        conn = get_db()
        conn.execute("""
            CREATE TABLE IF NOT EXISTS ambient_context (
                id TEXT PRIMARY KEY,
                timestamp TEXT DEFAULT (datetime('now')),
                active_app TEXT,
                window_title TEXT,
                detected_context TEXT,
                detected_topics TEXT,
                clipboard_content TEXT,
                metadata_json TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS ambient_suggestions (
                id TEXT PRIMARY KEY,
                timestamp TEXT DEFAULT (datetime('now')),
                context TEXT,
                suggestion TEXT,
                relevance REAL,
                shown INTEGER DEFAULT 0,
                acted_on INTEGER DEFAULT 0
            )
        """)
        conn.commit()
        conn.close()

    def log(self, msg: str):
        if self.verbose:
            print(f"  [{datetime.now().strftime('%H:%M:%S')}] {msg}")

    def get_active_window(self) -> Dict[str, str]:
        """Get active app and window title."""
        if not HAS_APPKIT:
            # Fallback: use AppleScript
            try:
                script = '''
                    tell application "System Events"
                        set frontApp to name of first application process whose frontmost is true
                        set frontWindow to ""
                        try
                            set frontWindow to name of front window of (first application process whose frontmost is true)
                        end try
                        return frontApp & "|" & frontWindow
                    end tell
                '''
                result = subprocess.run(
                    ['osascript', '-e', script],
                    capture_output=True, text=True, timeout=2
                )
                parts = result.stdout.strip().split('|')
                return {
                    'app': parts[0] if parts else '',
                    'title': parts[1] if len(parts) > 1 else '',
                }
            except:
                return {'app': '', 'title': ''}

        # Use PyObjC if available
        workspace = NSWorkspace.sharedWorkspace()
        active_app = workspace.frontmostApplication()
        return {
            'app': active_app.localizedName() if active_app else '',
            'title': '',  # Would need Accessibility API for window title
        }

    def get_clipboard(self) -> str:
        """Get current clipboard content."""
        if HAS_APPKIT:
            pb = NSPasteboard.generalPasteboard()
            content = pb.stringForType_("public.utf8-plain-text")
            return content if content else ""

        # Fallback
        try:
            result = subprocess.run(
                ['pbpaste'], capture_output=True, text=True, timeout=1
            )
            return result.stdout[:1000]
        except:
            return ""

    def detect_context(self, app: str, title: str, clipboard: str) -> str:
        """Detect work context from current state."""
        app_lower = app.lower()
        combined = f"{app} {title} {clipboard}".lower()

        scores = defaultdict(int)
        for context, patterns in WORK_CONTEXTS.items():
            for app_pattern in patterns['apps']:
                if app_pattern.lower() in app_lower:
                    scores[context] += 3
            for keyword in patterns['keywords']:
                if keyword in combined:
                    scores[context] += 1

        if scores:
            return max(scores, key=scores.get)
        return 'general'

    def extract_topics(self, title: str, clipboard: str) -> List[str]:
        """Extract topics from current context."""
        topics = []
        combined = f"{title} {clipboard}"

        # Extract URLs
        urls = re.findall(r'https?://[^\s<>"{}|\\^`\[\]]+', combined)
        for url in urls:
            parsed = urlparse(url)
            if 'github.com' in parsed.netloc:
                # Extract repo name
                parts = parsed.path.strip('/').split('/')
                if len(parts) >= 2:
                    topics.append(f"repo:{parts[0]}/{parts[1]}")
            topics.append(parsed.netloc)

        # Extract code-related terms
        code_patterns = [
            r'\b(React|Vue|Angular|Svelte)\b',
            r'\b(Python|JavaScript|TypeScript|Rust|Go|Swift)\b',
            r'\b(LLM|GPT|Claude|transformer|neural)\b',
            r'\b(Kubernetes|Docker|AWS|GCP|Azure)\b',
            r'\b(API|REST|GraphQL|gRPC)\b',
        ]
        for pattern in code_patterns:
            matches = re.findall(pattern, combined, re.IGNORECASE)
            topics.extend([m.lower() for m in matches])

        return list(set(topics))[:10]

    def capture_snapshot(self) -> Dict[str, Any]:
        """Capture current ambient context."""
        window = self.get_active_window()
        clipboard = self.get_clipboard()

        # Check for clipboard changes
        clipboard_changed = clipboard != self.last_clipboard and len(clipboard) > 10
        if clipboard_changed:
            self.last_clipboard = clipboard
            self.clipboard_history.append(clipboard[:500])
            self.clipboard_history = self.clipboard_history[-20:]  # Keep last 20

        context = self.detect_context(window['app'], window['title'], clipboard)
        topics = self.extract_topics(window['title'], clipboard if clipboard_changed else "")

        snapshot = {
            'timestamp': datetime.now().isoformat(),
            'app': window['app'],
            'title': window['title'][:200] if window['title'] else '',
            'context': context,
            'topics': topics,
            'clipboard_changed': clipboard_changed,
            'clipboard_preview': clipboard[:100] if clipboard_changed else None,
        }

        self.current_context = snapshot
        return snapshot

    def record_context(self, snapshot: Dict[str, Any]):
        """Record context to database (every 5 minutes or on significant change)."""
        conn = get_db()
        conn.execute("""
            INSERT INTO ambient_context
            (id, active_app, window_title, detected_context, detected_topics, clipboard_content, metadata_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            random_id(),
            snapshot['app'],
            snapshot['title'],
            snapshot['context'],
            json.dumps(snapshot['topics']),
            snapshot['clipboard_preview'],
            json.dumps(snapshot),
        ))
        conn.commit()
        conn.close()

    def generate_suggestions(self) -> List[Dict[str, Any]]:
        """Generate proactive suggestions based on current context."""
        if not self.current_context:
            return []

        conn = get_db()
        suggestions = []

        # Get current topics
        topics = self.current_context.get('topics', [])
        context = self.current_context.get('context', 'general')

        # Find related concepts in the knowledge base
        for topic in topics[:5]:
            # Search for matching concepts
            related = conn.execute("""
                SELECT c.label, pw.weight
                FROM concepts c
                LEFT JOIN preference_weights pw ON pw.target_id = c.id AND pw.weight_type = 'concept'
                WHERE c.active = 1
                  AND (c.label LIKE ? OR c.label LIKE ?)
                ORDER BY COALESCE(pw.weight, 0.5) DESC
                LIMIT 3
            """, (f"%{topic}%", f"%{topic.replace(':', '%')}%")).fetchall()

            for row in related:
                suggestions.append({
                    'type': 'related_concept',
                    'label': row['label'],
                    'weight': row['weight'] or 0.5,
                    'reason': f"Related to '{topic}' in your current context",
                })

        # Find relevant reports
        if topics:
            topic_pattern = '%' + '%'.join(topics[:3]) + '%'
            reports = conn.execute("""
                SELECT r.id, r.title, r.summary, r.impact_score
                FROM reports r
                WHERE r.title LIKE ? OR r.summary LIKE ?
                ORDER BY r.impact_score DESC
                LIMIT 5
            """, (topic_pattern, topic_pattern)).fetchall()

            for row in reports:
                suggestions.append({
                    'type': 'relevant_report',
                    'id': row['id'],
                    'title': row['title'],
                    'summary': row['summary'][:100] if row['summary'] else '',
                    'impact': row['impact_score'],
                    'reason': "Matches your current work context",
                })

        # Find sources to read
        if context == 'research':
            sources = conn.execute("""
                SELECT s.id, s.url, s.title, s.priority
                FROM sources s
                WHERE s.processed_at IS NULL
                  AND s.priority >= 7
                ORDER BY s.priority DESC
                LIMIT 3
            """).fetchall()

            for row in sources:
                suggestions.append({
                    'type': 'source_to_read',
                    'url': row['url'],
                    'title': row['title'],
                    'priority': row['priority'],
                    'reason': "High-priority source you haven't read yet",
                })

        conn.close()

        # Sort by relevance
        suggestions.sort(key=lambda x: x.get('weight', 0) + x.get('impact', 0) + x.get('priority', 0) / 10, reverse=True)
        return suggestions[:5]

    def get_anticipation_message(self) -> str:
        """Generate a proactive anticipation message."""
        suggestions = self.generate_suggestions()
        if not suggestions:
            return ""

        context = self.current_context.get('context', 'working')
        topics = self.current_context.get('topics', [])

        lines = [f"📍 You seem to be {context}"]
        if topics:
            lines.append(f"   Topics detected: {', '.join(topics[:3])}")
        lines.append("")
        lines.append("💡 Things that might help:")

        for i, s in enumerate(suggestions[:5], 1):
            if s['type'] == 'relevant_report':
                lines.append(f"   {i}. 📄 {s['title'][:50]}")
            elif s['type'] == 'related_concept':
                lines.append(f"   {i}. 🏷️ {s['label']} (interest weight: {s['weight']:.2f})")
            elif s['type'] == 'source_to_read':
                lines.append(f"   {i}. 🔗 {s['title'][:50]} (priority: {s['priority']})")

        return '\n'.join(lines)

    def run_daemon(self, interval: int = 30):
        """Run the ambient capture daemon."""
        print(f"[{datetime.now().isoformat()}] Starting ambient capture daemon")
        print(f"  Database: {DB_PATH}")
        print(f"  Capture interval: {interval}s")
        print(f"  Press Ctrl+C to stop\n")

        last_record_time = datetime.now() - timedelta(minutes=5)
        last_context = ""

        while self.running:
            try:
                snapshot = self.capture_snapshot()
                context_key = f"{snapshot['app']}:{snapshot['context']}"

                # Log if verbose
                self.log(f"App: {snapshot['app']}, Context: {snapshot['context']}, Topics: {snapshot['topics']}")

                # Record every 5 minutes or on context change
                should_record = (
                    datetime.now() - last_record_time > timedelta(minutes=5) or
                    context_key != last_context
                )

                if should_record:
                    self.record_context(snapshot)
                    last_record_time = datetime.now()
                    last_context = context_key
                    self.log("Context recorded")

                time.sleep(interval)

            except KeyboardInterrupt:
                print("\n\nAmbient capture stopped.")
                break
            except Exception as e:
                print(f"Error: {e}")
                time.sleep(interval)

    def show_status(self):
        """Show current ambient status."""
        snapshot = self.capture_snapshot()
        print("\n📡 Ambient Context Status")
        print("=" * 50)
        print(f"Active App: {snapshot['app']}")
        print(f"Window: {snapshot['title'][:60]}..." if snapshot['title'] else "Window: (none)")
        print(f"Context: {snapshot['context']}")
        print(f"Topics: {', '.join(snapshot['topics']) if snapshot['topics'] else '(none detected)'}")

        # Show recent context history
        conn = get_db()
        recent = conn.execute("""
            SELECT detected_context, COUNT(*) as cnt
            FROM ambient_context
            WHERE timestamp > datetime('now', '-1 hour')
            GROUP BY detected_context
            ORDER BY cnt DESC
        """).fetchall()
        conn.close()

        if recent:
            print(f"\nLast hour contexts:")
            for row in recent:
                print(f"  {row['detected_context']}: {row['cnt']} snapshots")


def main():
    parser = argparse.ArgumentParser(description="Ambient capture daemon for Ronald-GI")
    parser.add_argument("--status", action="store_true", help="Show current context")
    parser.add_argument("--suggestions", action="store_true", help="Get proactive suggestions")
    parser.add_argument("--interval", type=int, default=30, help="Capture interval in seconds")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    args = parser.parse_args()

    capture = AmbientCapture(verbose=args.verbose)

    if args.status:
        capture.show_status()
    elif args.suggestions:
        capture.capture_snapshot()  # Update context
        message = capture.get_anticipation_message()
        if message:
            print(message)
        else:
            print("No suggestions at this time.")
    else:
        capture.run_daemon(interval=args.interval)


if __name__ == "__main__":
    main()
