# Ronald-GI Deployment Guide

## Quick Start (macOS)

```bash
# 1. Clone and setup
git clone <repository>
cd dexter

# 2. Start services with Docker
docker-compose up -d

# 3. Import your browsing history
./scripts/ingest_history.sh

# 4. Start the scheduler daemon
python scripts/scheduler.py &

# 5. (Optional) Start ambient capture
python scripts/ambient_capture.py &
```

## Prerequisites

- Docker & Docker Compose
- Python 3.9+ (for ingestion scripts)
- macOS (for ambient capture features)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                         Ronald-GI                            │
├─────────────────────────────────────────────────────────────┤
│  Ingestion Layer       │  Processing Layer   │  API Layer   │
│  ─────────────────     │  ─────────────────  │  ──────────  │
│  • Browser History     │  • World Model      │  • REST API  │
│  • HackerNews          │  • Concept Extract  │  • Briefings │
│  • Twitter/X           │  • Report Gen       │  • Alerts    │
│  • Reading List        │  • Embeddings       │  • Telemetry │
│  • Ambient Capture     │  • Clustering       │              │
├─────────────────────────────────────────────────────────────┤
│                      SQLite Database                         │
│  /app/data/ronald.db                                         │
└─────────────────────────────────────────────────────────────┘
```

## Docker Deployment

### Production Configuration

```yaml
# docker-compose.prod.yml
version: '3.8'
services:
  api:
    image: ronald-gi/api:latest
    ports:
      - "3100:3100"
    volumes:
      - ./data:/app/data
    environment:
      - NODE_ENV=production
      - LOG_LEVEL=info
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3100/api/system/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  worker:
    image: ronald-gi/worker:latest
    volumes:
      - ./data:/app/data
    environment:
      - NODE_ENV=production
      - OLLAMA_URL=http://ollama:11434
    depends_on:
      - ollama
    restart: unless-stopped

  ollama:
    image: ollama/ollama:latest
    volumes:
      - ollama_data:/root/.ollama
    restart: unless-stopped

volumes:
  ollama_data:
```

### Build from Source

```bash
# Build all images
./scripts/build.sh

# Or build individually
docker build -t ronald-gi/api -f services/api/Dockerfile .
docker build -t ronald-gi/worker -f services/worker/Dockerfile .
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_PATH` | `/app/data/ronald.db` | SQLite database location |
| `OLLAMA_URL` | `http://ollama:11434` | Ollama API endpoint |
| `OLLAMA_MODEL` | `llama3.2` | Default LLM model |
| `EMBED_MODEL` | `nomic-embed-text` | Embedding model |
| `LOG_LEVEL` | `info` | Logging level |
| `PORT` | `3100` | API server port |

### Scheduler Configuration

Edit `scripts/scheduler.py` to customize task intervals:

```python
TASKS = {
    "hourly": {
        "interval_minutes": 60,
        "scripts": [
            ("ingest_hackernews.py", ["--filter", "github", "--limit", "30"]),
            ("ingest_xcancel.py", ["--limit", "20"]),
        ],
    },
    "every_6h": {
        "interval_minutes": 360,
        "scripts": [
            ("ingest_hackernews.py", ["--filter", "all", "--limit", "100"]),
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
```

## macOS Daemon Setup

### Using launchd (Recommended)

Create `/Library/LaunchAgents/com.ronald-gi.scheduler.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.ronald-gi.scheduler</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/python3</string>
        <string>/path/to/dexter/scripts/scheduler.py</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/path/to/dexter/data/logs/scheduler.log</string>
    <key>StandardErrorPath</key>
    <string>/path/to/dexter/data/logs/scheduler.error.log</string>
</dict>
</plist>
```

Load the daemon:

```bash
launchctl load ~/Library/LaunchAgents/com.ronald-gi.scheduler.plist
```

### Ambient Capture Daemon

Create `/Library/LaunchAgents/com.ronald-gi.ambient.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.ronald-gi.ambient</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/python3</string>
        <string>/path/to/dexter/scripts/ambient_capture.py</string>
        <string>--interval</string>
        <string>30</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
```

## Security Considerations

### Local-First Design

Ronald-GI is designed to run locally. All data stays on your machine:

- SQLite database stored locally
- No cloud dependencies (except optional Ollama)
- PII detection for sensitive content
- Audit logging for all operations

### Network Exposure

If exposing the API externally:

1. Add authentication middleware
2. Use HTTPS with valid certificates
3. Configure firewall rules
4. Enable rate limiting

```typescript
// Example: Add JWT authentication
app.addHook('preHandler', async (request, reply) => {
  const token = request.headers.authorization?.replace('Bearer ', '');
  if (!token || !verifyToken(token)) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
});
```

## Monitoring

### Health Checks

```bash
# API health
curl http://localhost:3100/api/system/health

# Scheduler status
python scripts/scheduler.py --status

# Ambient capture status
python scripts/ambient_capture.py --status
```

### Performance Metrics

The API exposes performance metrics at `/api/system/stats`:

```json
{
  "reports": 1234,
  "concepts": 567,
  "sources": 890,
  "visits": 12345,
  "jobs": {
    "pending": 5,
    "completed": 1000
  }
}
```

### Alerting

Configure webhook alerting for production:

```typescript
import { WebhookNotificationChannel } from './lib/alerting';

const webhook = new WebhookNotificationChannel();
webhook.configure('https://hooks.slack.com/services/...');
alertManager.addChannel(webhook);
```

## Backup & Recovery

### Database Backup

```bash
# Simple copy (while services stopped)
cp /app/data/ronald.db /backup/ronald-$(date +%Y%m%d).db

# Or use SQLite backup (while running)
sqlite3 /app/data/ronald.db ".backup /backup/ronald-$(date +%Y%m%d).db"
```

### Scheduled Backups

Add to your crontab:

```bash
0 2 * * * sqlite3 /path/to/data/ronald.db ".backup /backup/ronald-$(date +\%Y\%m\%d).db"
```

## Troubleshooting

### Common Issues

**Ollama connection failed**
```bash
# Check Ollama is running
curl http://localhost:11434/api/tags

# Pull required models
ollama pull llama3.2
ollama pull nomic-embed-text
```

**Database locked**
```bash
# Find processes using the database
lsof /app/data/ronald.db

# Enable WAL mode (already default)
sqlite3 /app/data/ronald.db "PRAGMA journal_mode=WAL;"
```

**High memory usage**
```bash
# Reduce worker concurrency
export WORKER_CONCURRENCY=1

# Or limit job queue
sqlite3 /app/data/ronald.db "DELETE FROM job_queue WHERE status='failed';"
```

### Logs

```bash
# API logs
docker logs ronald-gi-api

# Worker logs
docker logs ronald-gi-worker

# Scheduler logs
tail -f /app/data/logs/scheduler.log
```

## Upgrading

```bash
# Pull latest changes
git pull origin main

# Rebuild images
./scripts/build.sh

# Restart services
docker-compose down
docker-compose up -d

# Run migrations (automatic on startup)
```
