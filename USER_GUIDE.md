# Ronald-GI User Guide

> **Your autonomous research assistant that learns from you**

Ronald-GI watches your browsing patterns, monitors sources you care about, and proactively surfaces insights tailored to your interests. It's designed for the curious mind that wants to stay ahead without constant manual effort.

## Getting Started

### First Run

After installation, Ronald-GI needs some initial data to learn from:

```bash
# Import your browsing history
./scripts/ingest_history.sh

# Import Safari Reading List (macOS)
python scripts/ingest_reading_list.py

# Start monitoring HackerNews and Twitter
python scripts/scheduler.py --once
```

### Daily Workflow

1. **Morning**: Check your daily briefing
2. **Throughout day**: Pin interesting reports, dismiss irrelevant ones
3. **Evening**: Review what Ronald learned, adjust priorities

## Core Features

### Daily Briefing

The daily briefing answers: *"What should I know today?"*

```bash
# Get text summary
curl http://localhost:3100/api/briefing/summary

# Get full briefing with all details
curl http://localhost:3100/api/briefing
```

The briefing includes:
- **Discovery Spikes**: Bursts of related browsing activity detected
- **Top Reports**: High-impact findings you should see
- **Trending Concepts**: Topics rising in your interests
- **Suggested Actions**: What you might want to do next
- **Learning Insights**: What Ronald learned about you

### Report Types

| Type | Description |
|------|-------------|
| `research_brief` | Summary of a topic or source |
| `repo_signal` | Notable GitHub repository discovered |
| `decision_memo` | Comparison or recommendation |
| `concept_drift` | Significant shift in your interests |
| `watchlist_alert` | Update from a monitored source |

### Interacting with Reports

Your interactions train the system:

| Action | Effect |
|--------|--------|
| **Pin** | Signals high value, boosts related concepts |
| **Expand** | Shows moderate interest |
| **Dismiss** | Negative signal, reduces related weights |
| **Scroll** | Passive engagement signal |

```bash
# Pin a report
curl -X POST http://localhost:3100/api/reports/{id}/pin

# Record a telemetry event
curl -X POST http://localhost:3100/api/telemetry \
  -H "Content-Type: application/json" \
  -d '{"event_type": "pin", "report_id": "abc123"}'
```

## The World Model

Ronald builds a personalized "world model" of your interests:

### Concepts

Concepts are extracted topics, technologies, people, or ideas. Each has:

- **Label**: The concept name (e.g., "transformer models")
- **Weight**: How much you care (0.1 to 2.0)
- **Mention Count**: How often it appears in your sources

View your concepts:
```bash
curl http://localhost:3100/api/concepts?active=true
```

### Preference Weights

Weights adjust automatically based on your behavior:

- **Engagement** (+): Pinning, clicking, expanding reports
- **Decay** (-): Time without engagement
- **Dismissal** (-): Explicitly dismissing reports

The system also detects:
- **Discovery Spikes**: Sudden interest in a topic
- **Fading Interests**: Declining engagement
- **New Patterns**: Emerging behaviors

### Viewing Your Obsession Gradient

Your current top interests (the "obsession gradient"):

```bash
curl http://localhost:3100/api/briefing/insights
```

## Source Monitoring

### What Gets Monitored

1. **Browser History**: Chrome, Safari, Firefox
2. **HackerNews**: Hourly scans for GitHub projects
3. **Twitter/X**: Selected accounts (via xcancel)
4. **Reading List**: Safari Reading List (priority 9)
5. **Manual Additions**: Anything you add

### Adding Sources

```bash
# Add a source manually
curl -X POST http://localhost:3100/api/sources \
  -H "Content-Type: application/json" \
  -d '{"url": "https://github.com/interesting/repo", "priority": 8}'
```

### Priority Levels

| Priority | Source Type |
|----------|-------------|
| 9-10 | Reading List, manually pinned |
| 7-8 | Twitter shares from followed accounts |
| 5-6 | HackerNews front page |
| 3-4 | Browser history |
| 1-2 | Discovered via link crawling |

## Ambient Capture (ADHD Mode)

For those with scattered attention, ambient capture provides:

### What It Captures

- **Active App/Window**: What you're working on
- **Clipboard**: URLs, code snippets, research terms
- **Context Detection**: coding, research, writing, meeting

### How to Use

```bash
# Check current context
python scripts/ambient_capture.py --status

# Get proactive suggestions
python scripts/ambient_capture.py --suggestions

# Run as daemon (background)
python scripts/ambient_capture.py &
```

### Context-Aware Suggestions

Based on your current activity, Ronald suggests:

- Related concepts from your knowledge base
- Relevant reports you might have forgotten
- High-priority sources you haven't read

Example output:
```
📍 You seem to be coding
   Topics detected: python, llm, embeddings

💡 Things that might help:
   1. 📄 Vector Database Comparison (impact: 0.85)
   2. 🏷️ semantic-search (interest weight: 1.45)
   3. 🔗 Pinecone vs Weaviate Guide (priority: 8)
```

## Proactive Alerts

Ronald alerts you when something important happens:

### Alert Types

| Type | Trigger |
|------|---------|
| `discovery_spike` | 5+ visits to related pages in 1 hour |
| `high_impact` | Report with 85%+ impact score |
| `action_needed` | Research getting stale |
| `learning_insight` | Significant preference shift |

### Managing Alerts

```bash
# Get pending alerts
curl http://localhost:3100/api/briefing/alerts

# Dismiss an alert
curl -X POST http://localhost:3100/api/briefing/alerts/{id}/dismiss
```

## Research Planning

Ronald plans research autonomously based on your interests:

### Viewing Plans

```bash
curl http://localhost:3100/api/briefing/research-plan
```

### How Research Gets Prioritized

1. **High-weight concepts** without recent reports
2. **Discovery spikes** that warrant investigation
3. **Scheduled deep dives** for weekend exploration

### Executing Research

```bash
# Execute next planned research
curl -X POST http://localhost:3100/api/briefing/research/execute
```

## Tips for Power Users

### Training the System Faster

1. **Pin liberally**: Every pin teaches Ronald what you value
2. **Dismiss actively**: Negative signals are just as important
3. **Use the Reading List**: Items here get priority 9
4. **Be consistent**: Daily interactions improve learning

### Customizing Behavior

Edit the scheduler for different monitoring patterns:

```python
# scripts/scheduler.py
TASKS = {
    "hourly": {
        "scripts": [
            # Add your own data sources
            ("ingest_hackernews.py", ["--filter", "site:github.com", "--limit", "50"]),
            ("ingest_xcancel.py", ["--accounts", "karpathy,ylecun"]),
        ],
    },
}
```

### Adding Custom Accounts to Monitor

Edit `scripts/ingest_xcancel.py`:

```python
DEFAULT_ACCOUNTS = [
    "karpathy",
    "ylecun",
    # Add your favorites
    "your_favorite_account",
]
```

### Adjusting World Model Parameters

Edit `scripts/evolve_worldmodel.py`:

```python
ENGAGEMENT_WEIGHT_BOOST = 0.1  # How much pins boost weight
DECAY_RATE = 0.95              # Weekly decay multiplier
SPIKE_THRESHOLD = 5            # Visits per hour for spike detection
```

## FAQ

**Q: How long until Ronald "gets" me?**
A: Initial learning happens within a few days of consistent use. Deep personalization takes 2-4 weeks.

**Q: Can I reset my preferences?**
A: Delete preference_weights from the database, or run:
```sql
DELETE FROM preference_weights WHERE weight_type = 'concept';
```

**Q: How much storage does it use?**
A: Typically 50-200MB for the database, depending on browsing history size.

**Q: Is my data sent anywhere?**
A: No. Everything runs locally. The only network calls are to Ollama and the sources you monitor.

**Q: Can I run without Ollama?**
A: Some features require LLM processing. Without Ollama, you can still use browsing tracking and basic report viewing.

## Keyboard Shortcuts (Web UI)

| Shortcut | Action |
|----------|--------|
| `j/k` | Navigate reports |
| `p` | Pin current report |
| `d` | Dismiss current report |
| `Enter` | Expand report |
| `b` | Go to briefing |
| `?` | Show help |

## API Quick Reference

```bash
# Daily briefing
GET /api/briefing

# List reports
GET /api/reports?sort=blended_score&limit=10

# Pin a report
POST /api/reports/{id}/pin

# Record interaction
POST /api/telemetry
Body: {"event_type": "click", "report_id": "..."}

# Get alerts
GET /api/briefing/alerts

# System health
GET /api/system/health
```

Full API documentation: `services/api/openapi.yaml`
