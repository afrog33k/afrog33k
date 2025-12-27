#!/usr/bin/env python3
"""
User Profile Seeder for Ronald-GI

Seeds the system with user profile information gathered from public sources.
This enables personalized anticipation and context-aware assistance.

Based on research:
- BDI (Belief-Desire-Intention) user modeling from Satori (arxiv:2410.16668)
- Personal knowledge graphs from Personalized RAG Survey (2025)

Usage:
    python scripts/seed_user_profile.py
    python scripts/seed_user_profile.py --user-id ronald
"""

import argparse
import sqlite3
import json
import hashlib
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any

DB_PATH = Path(__file__).parent.parent / "data" / "ronald.db"


def get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def generate_id(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:16]


def ensure_tables(conn: sqlite3.Connection):
    """Create user profile tables based on BDI model."""
    conn.executescript("""
        -- Core user profile (identity + background)
        CREATE TABLE IF NOT EXISTS user_profiles (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            username TEXT,
            email TEXT,
            location TEXT,
            bio TEXT,
            profile_json TEXT,  -- Full structured profile
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );

        -- BDI Model: Beliefs (what user thinks is true about the world)
        CREATE TABLE IF NOT EXISTS user_beliefs (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            belief_type TEXT NOT NULL,  -- 'expertise', 'interest', 'preference', 'context'
            subject TEXT NOT NULL,
            predicate TEXT,
            object TEXT,
            confidence REAL DEFAULT 0.8,
            source TEXT,  -- 'inferred', 'stated', 'observed'
            evidence_json TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES user_profiles(id)
        );

        -- BDI Model: Desires (what user wants to achieve)
        CREATE TABLE IF NOT EXISTS user_desires (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            desire_type TEXT NOT NULL,  -- 'goal', 'aspiration', 'need', 'preference'
            description TEXT NOT NULL,
            priority INTEGER DEFAULT 5,  -- 1-10
            timeframe TEXT,  -- 'immediate', 'short-term', 'long-term'
            status TEXT DEFAULT 'active',  -- 'active', 'achieved', 'abandoned'
            related_concepts TEXT,  -- JSON array of concept IDs
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES user_profiles(id)
        );

        -- BDI Model: Intentions (what user plans to do)
        CREATE TABLE IF NOT EXISTS user_intentions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            intention_type TEXT NOT NULL,  -- 'task', 'project', 'habit', 'exploration'
            description TEXT NOT NULL,
            parent_desire_id TEXT,  -- Links to the desire this fulfills
            status TEXT DEFAULT 'planned',  -- 'planned', 'in_progress', 'completed', 'blocked'
            priority INTEGER DEFAULT 5,
            deadline TEXT,
            context_json TEXT,  -- Conditions for activation
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES user_profiles(id),
            FOREIGN KEY (parent_desire_id) REFERENCES user_desires(id)
        );

        -- User expertise/skills (derived from profile)
        CREATE TABLE IF NOT EXISTS user_skills (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            skill_name TEXT NOT NULL,
            category TEXT,  -- 'language', 'framework', 'domain', 'tool'
            proficiency_level TEXT,  -- 'expert', 'proficient', 'familiar', 'learning'
            years_experience INTEGER,
            last_used_at TEXT,
            source TEXT,  -- 'github', 'linkedin', 'stated'
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES user_profiles(id)
        );

        -- User work history (for context)
        CREATE TABLE IF NOT EXISTS user_work_history (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            company TEXT NOT NULL,
            role TEXT NOT NULL,
            description TEXT,
            start_date TEXT,
            end_date TEXT,
            technologies_json TEXT,
            achievements_json TEXT,
            source TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES user_profiles(id)
        );

        -- Indexes
        CREATE INDEX IF NOT EXISTS idx_beliefs_user ON user_beliefs(user_id);
        CREATE INDEX IF NOT EXISTS idx_beliefs_type ON user_beliefs(belief_type);
        CREATE INDEX IF NOT EXISTS idx_desires_user ON user_desires(user_id);
        CREATE INDEX IF NOT EXISTS idx_intentions_user ON user_intentions(user_id);
        CREATE INDEX IF NOT EXISTS idx_skills_user ON user_skills(user_id);
    """)
    conn.commit()


def seed_ronald_profile(conn: sqlite3.Connection) -> str:
    """Seed Ronald Adonyo's profile from public sources."""

    user_id = "ronald_adonyo"

    # Core profile
    profile = {
        "name": "Ronald Adonyo",
        "username": "afrog33k",
        "email": "ronald@salespatter.io",
        "location": "Kampala, Uganda / Scottsdale, AZ",
        "current_role": "CTO & Co-Founder",
        "company": "Patter AI",
        "website": "https://www.salespatter.io",
        "github": "https://github.com/afrog33k",
        "linkedin": "https://www.linkedin.com/in/ronaldadonyo/",
        "education": {
            "degree": "Bachelor of Science in Nanotechnology",
            "field": "Electronics Engineering",
            "institution": "Multimedia University",
            "years": "2007-2011"
        },
        "personality_indicators": {
            "mbti": "INTJ",  # User stated
            "adhd": True,  # User stated
            "iq_range": "150-167",  # User stated
            "traits": ["analytical", "innovative", "technical-depth", "scattered-attention"]
        },
        "years_experience": 25,
        "github_repos": 311,
        "github_followers": 32,
        "notable_achievement": "Scaled tech from $50M to $1B, leading to $825M acquisition (2021)"
    }

    conn.execute("""
        INSERT OR REPLACE INTO user_profiles (id, name, username, email, location, bio, profile_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (
        user_id,
        profile["name"],
        profile["username"],
        profile["email"],
        profile["location"],
        f"CTO & Co-Founder at {profile['company']}. 25+ years in software engineering.",
        json.dumps(profile)
    ))

    # Seed skills
    skills = [
        # Languages
        ("C", "language", "expert", 20),
        ("C++", "language", "expert", 20),
        ("C#", "language", "expert", 15),
        ("Python", "language", "proficient", 10),
        ("JavaScript", "language", "expert", 15),
        ("Java", "language", "proficient", 10),
        ("TypeScript", "language", "proficient", 5),
        ("PHP", "language", "familiar", 10),

        # Frameworks
        (".NET", "framework", "expert", 15),
        (".NET Core", "framework", "proficient", 5),
        ("React", "framework", "proficient", 5),
        ("Redux", "framework", "proficient", 3),

        # Platforms
        ("iOS Development", "platform", "proficient", 10),
        ("Android Development", "platform", "proficient", 10),
        ("Windows Phone", "platform", "familiar", 5),
        ("Unity", "platform", "familiar", 3),

        # Domains
        ("AI/ML", "domain", "proficient", 5),
        ("Sales Enablement", "domain", "expert", 10),
        ("Compiler/Transpiler Design", "domain", "expert", 10),
        ("Healthcare Systems (LIMS/HMS)", "domain", "proficient", 5),
        ("Payment Gateways", "domain", "proficient", 5),
        ("Nanotechnology", "domain", "familiar", 4),

        # Tools
        ("Git", "tool", "expert", 15),
        ("Visual Studio", "tool", "expert", 15),
        ("VS Code", "tool", "expert", 5),
        ("PostgreSQL", "tool", "proficient", 10),
        ("Microsoft Roslyn", "tool", "expert", 5),
    ]

    for skill_name, category, level, years in skills:
        skill_id = generate_id(f"{user_id}:{skill_name}")
        conn.execute("""
            INSERT OR REPLACE INTO user_skills (id, user_id, skill_name, category, proficiency_level, years_experience, source)
            VALUES (?, ?, ?, ?, ?, ?, 'github+linkedin')
        """, (skill_id, user_id, skill_name, category, level, years))

    # Seed work history
    work_history = [
        {
            "company": "Patter AI",
            "role": "CTO & Co-Founder",
            "description": "Building AI-powered sales enablement solutions. Leads product innovation and development.",
            "start_date": "2023",
            "technologies": ["AI/ML", "Python", "React", "Audio Analysis"],
            "achievements": ["Pioneering consultative sales enablement with AI"]
        },
        {
            "company": "ADT Solar",
            "role": "Software Engineering Manager",
            "description": "Led team maintaining sales enablement platform. Part of scaling from $50M to $1B.",
            "start_date": "2019",
            "end_date": "2023",
            "technologies": ["C#", ".NET", "React", "SQL Server"],
            "achievements": ["Scaled tech for $825M acquisition"]
        },
        {
            "company": "CloseHero",
            "role": "Technical Lead",
            "description": "Designed and developed core platform for consultative sales organizations.",
            "start_date": "2017",
            "end_date": "2019",
            "technologies": ["JavaScript", "React", "Node.js"],
            "achievements": ["Built scalable sales platform"]
        },
        {
            "company": "Irio Systems",
            "role": "Developer",
            "description": "Mobile Money Payment Gateways, LIMS, HMS for healthcare.",
            "start_date": "2012",
            "end_date": "2017",
            "technologies": ["Java", "Android", "PHP", "MySQL"],
            "achievements": ["Payment gateways", "Healthcare systems"]
        }
    ]

    for job in work_history:
        job_id = generate_id(f"{user_id}:{job['company']}:{job['role']}")
        conn.execute("""
            INSERT OR REPLACE INTO user_work_history
            (id, user_id, company, role, description, start_date, end_date, technologies_json, achievements_json, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'linkedin')
        """, (
            job_id, user_id, job["company"], job["role"],
            job["description"], job.get("start_date"), job.get("end_date"),
            json.dumps(job.get("technologies", [])),
            json.dumps(job.get("achievements", [])),
        ))

    # Seed beliefs (what Ronald knows/believes)
    beliefs = [
        # Expertise beliefs
        ("expertise", "Ronald", "is_expert_in", "C# to Native transpilation", 0.95, "SharpNative project"),
        ("expertise", "Ronald", "is_expert_in", "Sales enablement technology", 0.9, "Patter AI role"),
        ("expertise", "Ronald", "is_expert_in", "Scaling engineering teams", 0.9, "$825M acquisition"),
        ("expertise", "Ronald", "understands", "AI/ML applications in sales", 0.85, "Patter AI focus"),

        # Interest beliefs
        ("interest", "Ronald", "is_interested_in", "Autonomous AI agents", 0.9, "Building Ronald-GI"),
        ("interest", "Ronald", "is_interested_in", "Personal knowledge management", 0.9, "Ronald-GI project"),
        ("interest", "Ronald", "is_interested_in", "ADHD productivity tools", 0.95, "User stated"),
        ("interest", "Ronald", "is_interested_in", "Compiler/transpiler technology", 0.85, "SharpNative"),
        ("interest", "Ronald", "is_interested_in", "Memory augmentation AI", 0.9, "Current research"),

        # Context beliefs
        ("context", "Ronald", "works_in", "High-pressure startup environment", 0.8, "CTO role"),
        ("context", "Ronald", "has", "INTJ personality type", 0.95, "User stated"),
        ("context", "Ronald", "has", "ADHD", 0.95, "User stated"),
        ("context", "Ronald", "has", "High IQ (150-167)", 0.9, "User stated"),
        ("context", "Ronald", "experiences", "Scattered attention/memory", 0.9, "User stated"),

        # Preference beliefs
        ("preference", "Ronald", "prefers", "Non-intrusive AI assistance", 0.85, "Design requirements"),
        ("preference", "Ronald", "prefers", "Proactive over reactive systems", 0.9, "Design requirements"),
        ("preference", "Ronald", "prefers", "Local-first architecture", 0.85, "Privacy focus"),
        ("preference", "Ronald", "values", "Deep technical depth", 0.9, "Work history"),
    ]

    for belief_type, subject, predicate, obj, confidence, evidence in beliefs:
        belief_id = generate_id(f"{user_id}:{subject}:{predicate}:{obj}")
        conn.execute("""
            INSERT OR REPLACE INTO user_beliefs
            (id, user_id, belief_type, subject, predicate, object, confidence, source, evidence_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'observed', ?)
        """, (
            belief_id, user_id, belief_type, subject, predicate, obj, confidence,
            json.dumps({"source": evidence})
        ))

    # Seed desires (what Ronald wants)
    desires = [
        ("goal", "Build an AI that truly understands and anticipates my needs", 10, "long-term",
         ["autonomous-ai", "personal-assistant", "memory-augmentation"]),
        ("goal", "Reduce cognitive load from scattered attention", 9, "immediate",
         ["adhd", "productivity", "attention-management"]),
        ("goal", "Never miss important research or insights", 8, "ongoing",
         ["research", "knowledge-management", "proactive-ai"]),
        ("aspiration", "Create technology that scales businesses", 8, "long-term",
         ["startup", "scaling", "technology"]),
        ("need", "Memory augmentation for ADHD", 9, "immediate",
         ["adhd", "memory", "recall"]),
        ("preference", "Have AI do research while I focus on high-value work", 8, "ongoing",
         ["automation", "delegation", "focus"]),
    ]

    for desire_type, description, priority, timeframe, concepts in desires:
        desire_id = generate_id(f"{user_id}:{description[:50]}")
        conn.execute("""
            INSERT OR REPLACE INTO user_desires
            (id, user_id, desire_type, description, priority, timeframe, related_concepts)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (desire_id, user_id, desire_type, description, priority, timeframe, json.dumps(concepts)))

    # Seed current intentions
    intentions = [
        ("project", "Complete Ronald-GI autonomous research assistant", "in_progress", 10,
         {"requires": ["memory-layer", "anticipation", "self-evolution"]}),
        ("exploration", "Research state-of-the-art in personal AI assistants", "in_progress", 9,
         {"focus": ["arxiv-2025", "github-projects", "adhd-tools"]}),
        ("task", "Implement BDI user modeling", "planned", 8,
         {"based_on": "Satori paper arxiv:2410.16668"}),
        ("task", "Implement attention state inference", "planned", 8,
         {"based_on": "ADHD paper arxiv:2507.06864"}),
        ("habit", "Daily briefing review", "active", 7,
         {"trigger": "morning", "duration": "10-15 min"}),
    ]

    for intention_type, description, status, priority, context in intentions:
        intention_id = generate_id(f"{user_id}:{description[:50]}")
        conn.execute("""
            INSERT OR REPLACE INTO user_intentions
            (id, user_id, intention_type, description, status, priority, context_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (intention_id, user_id, intention_type, description, status, priority, json.dumps(context)))

    conn.commit()
    return user_id


def seed_concepts_from_profile(conn: sqlite3.Connection, user_id: str):
    """Create concepts from user profile for knowledge graph integration."""

    # Get skills and create concepts
    skills = conn.execute(
        "SELECT skill_name, category, proficiency_level FROM user_skills WHERE user_id = ?",
        (user_id,)
    ).fetchall()

    for skill in skills:
        concept_id = generate_id(f"skill:{skill['skill_name']}")
        try:
            conn.execute("""
                INSERT OR IGNORE INTO concepts (id, label, type, active, mention_count)
                VALUES (?, ?, 'skill', 1, 1)
            """, (concept_id, skill['skill_name'].lower()))
        except:
            pass  # Table might not exist yet

    # Get interests from beliefs
    interests = conn.execute("""
        SELECT object FROM user_beliefs
        WHERE user_id = ? AND belief_type = 'interest'
    """, (user_id,)).fetchall()

    for interest in interests:
        concept_id = generate_id(f"interest:{interest['object']}")
        try:
            conn.execute("""
                INSERT OR IGNORE INTO concepts (id, label, type, active, mention_count)
                VALUES (?, ?, 'interest', 1, 5)
            """, (concept_id, interest['object'].lower()))
        except:
            pass

    conn.commit()


def print_profile_summary(conn: sqlite3.Connection, user_id: str):
    """Print a summary of the seeded profile."""

    profile = conn.execute(
        "SELECT * FROM user_profiles WHERE id = ?", (user_id,)
    ).fetchone()

    skills_count = conn.execute(
        "SELECT COUNT(*) as c FROM user_skills WHERE user_id = ?", (user_id,)
    ).fetchone()['c']

    beliefs_count = conn.execute(
        "SELECT COUNT(*) as c FROM user_beliefs WHERE user_id = ?", (user_id,)
    ).fetchone()['c']

    desires_count = conn.execute(
        "SELECT COUNT(*) as c FROM user_desires WHERE user_id = ?", (user_id,)
    ).fetchone()['c']

    intentions_count = conn.execute(
        "SELECT COUNT(*) as c FROM user_intentions WHERE user_id = ?", (user_id,)
    ).fetchone()['c']

    print(f"\n{'='*60}")
    print(f"  User Profile Seeded: {profile['name']}")
    print(f"{'='*60}")
    print(f"  Username: @{profile['username']}")
    print(f"  Location: {profile['location']}")
    print(f"")
    print(f"  BDI Model Populated:")
    print(f"    • Beliefs: {beliefs_count}")
    print(f"    • Desires: {desires_count}")
    print(f"    • Intentions: {intentions_count}")
    print(f"    • Skills: {skills_count}")
    print(f"{'='*60}\n")


def main():
    parser = argparse.ArgumentParser(description="Seed user profile for Ronald-GI")
    parser.add_argument("--user-id", default="ronald_adonyo", help="User ID to seed")
    parser.add_argument("--dry-run", action="store_true", help="Don't write to database")
    args = parser.parse_args()

    print(f"[{datetime.now().isoformat()}] Seeding user profile...")

    conn = get_db()
    ensure_tables(conn)

    if not args.dry_run:
        user_id = seed_ronald_profile(conn)
        seed_concepts_from_profile(conn, user_id)
        print_profile_summary(conn, user_id)
    else:
        print("  [DRY RUN] Would seed profile for Ronald Adonyo")

    conn.close()


if __name__ == "__main__":
    main()
