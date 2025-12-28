# Ronald-GI as MCP Architecture

## The Insight

Instead of building a standalone cognitive architecture, Ronald-GI becomes a **set of MCP servers** that give Claude (or any LLM) persistent memory, user modeling, and ADHD-aware capabilities.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Claude Code / Claude Desktop                      │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                         MCP Servers                              │   │
│  │                                                                  │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │   │
│  │  │ ronald-gi-   │  │ ronald-gi-   │  │ ronald-gi-   │           │   │
│  │  │   memory     │  │   user       │  │   adhd       │           │   │
│  │  │              │  │              │  │              │           │   │
│  │  │ • remember   │  │ • get_user   │  │ • get_state  │           │   │
│  │  │ • recall     │  │ • beliefs    │  │ • suggest    │           │   │
│  │  │ • forget     │  │ • desires    │  │ • nudge      │           │   │
│  │  │ • connect    │  │ • intentions │  │ • drives     │           │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘           │   │
│  │                                                                  │   │
│  │  ┌──────────────┐  ┌──────────────┐                             │   │
│  │  │ ronald-gi-   │  │ ronald-gi-   │                             │   │
│  │  │   graph      │  │   heartbeat  │                             │   │
│  │  │              │  │              │                             │   │
│  │  │ • causes     │  │ • status     │                             │   │
│  │  │ • supports   │  │ • beat       │                             │   │
│  │  │ • contradicts│  │ • config     │                             │   │
│  │  │ • path       │  │              │                             │   │
│  │  └──────────────┘  └──────────────┘                             │   │
│  │                                                                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│                               ↓                                         │
│                                                                         │
│                    SQLite Database (Local-First)                        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Why MCP is Better

| Aspect | Standalone System | MCP Architecture |
|--------|-------------------|------------------|
| Integration | Custom client | Works with Claude Code, Desktop |
| Portability | One platform | Any MCP-compatible client |
| Updates | Requires app update | MCP servers update independently |
| Composability | Monolithic | Mix with other MCP servers |
| Development | Custom UI | Use Claude's UI |
| Testing | Custom test harness | Claude can test directly |

## MCP Server Definitions

### 1. ronald-gi-memory (Core Memory)

```json
{
  "name": "ronald-gi-memory",
  "description": "Persistent memory for Claude - remember, recall, and connect information across sessions",
  "tools": [
    {
      "name": "remember",
      "description": "Store information in long-term memory with optional type and importance",
      "inputSchema": {
        "type": "object",
        "properties": {
          "content": { "type": "string", "description": "What to remember" },
          "type": { "enum": ["episodic", "semantic", "procedural"], "default": "semantic" },
          "importance": { "type": "number", "minimum": 0, "maximum": 1, "default": 0.5 },
          "source": { "type": "string", "description": "Where this came from" }
        },
        "required": ["content"]
      }
    },
    {
      "name": "recall",
      "description": "Search memories by semantic similarity or exact query",
      "inputSchema": {
        "type": "object",
        "properties": {
          "query": { "type": "string", "description": "What to search for" },
          "limit": { "type": "integer", "default": 5 },
          "type": { "enum": ["episodic", "semantic", "procedural", "all"], "default": "all" },
          "min_similarity": { "type": "number", "default": 0.5 }
        },
        "required": ["query"]
      }
    },
    {
      "name": "recall_recent",
      "description": "Get the most recent memories",
      "inputSchema": {
        "type": "object",
        "properties": {
          "limit": { "type": "integer", "default": 10 },
          "hours": { "type": "integer", "description": "Within last N hours" }
        }
      }
    },
    {
      "name": "forget",
      "description": "Remove a memory by ID",
      "inputSchema": {
        "type": "object",
        "properties": {
          "memory_id": { "type": "string" }
        },
        "required": ["memory_id"]
      }
    },
    {
      "name": "connect",
      "description": "Create a relationship between two memories",
      "inputSchema": {
        "type": "object",
        "properties": {
          "from_id": { "type": "string" },
          "to_id": { "type": "string" },
          "relationship": { "enum": ["CAUSES", "CONTRADICTS", "SUPPORTS", "RELATED"] },
          "strength": { "type": "number", "default": 0.5 }
        },
        "required": ["from_id", "to_id", "relationship"]
      }
    }
  ],
  "resources": [
    {
      "uri": "memory://stats",
      "name": "Memory Statistics",
      "description": "Get memory system statistics"
    },
    {
      "uri": "memory://graph",
      "name": "Memory Graph",
      "description": "Visual representation of memory connections"
    }
  ]
}
```

### 2. ronald-gi-user (BDI User Model)

```json
{
  "name": "ronald-gi-user",
  "description": "Belief-Desire-Intention model for understanding and tracking user state",
  "tools": [
    {
      "name": "get_user_profile",
      "description": "Get the current user's profile and preferences"
    },
    {
      "name": "get_beliefs",
      "description": "Get beliefs about the user",
      "inputSchema": {
        "type": "object",
        "properties": {
          "category": { "enum": ["preference", "behavior", "context", "capability"] },
          "min_confidence": { "type": "number", "default": 0.3 }
        }
      }
    },
    {
      "name": "add_belief",
      "description": "Add a new belief about the user",
      "inputSchema": {
        "type": "object",
        "properties": {
          "content": { "type": "string" },
          "category": { "type": "string" },
          "confidence": { "type": "number" },
          "source": { "enum": ["stated", "observed", "inferred"] }
        },
        "required": ["content", "category"]
      }
    },
    {
      "name": "get_desires",
      "description": "Get user's goals and wishes",
      "inputSchema": {
        "type": "object",
        "properties": {
          "active_only": { "type": "boolean", "default": true }
        }
      }
    },
    {
      "name": "add_desire",
      "description": "Track a new user goal or wish",
      "inputSchema": {
        "type": "object",
        "properties": {
          "description": { "type": "string" },
          "priority": { "type": "number", "default": 5 }
        },
        "required": ["description"]
      }
    },
    {
      "name": "get_intentions",
      "description": "Get user's planned actions",
      "inputSchema": {
        "type": "object",
        "properties": {
          "status": { "enum": ["pending", "active", "completed", "abandoned"] }
        }
      }
    },
    {
      "name": "track_intention",
      "description": "Track a user's commitment to an action",
      "inputSchema": {
        "type": "object",
        "properties": {
          "action": { "type": "string" },
          "desire_id": { "type": "string" },
          "deadline": { "type": "string", "format": "date-time" }
        },
        "required": ["action"]
      }
    },
    {
      "name": "complete_intention",
      "description": "Mark an intention as completed",
      "inputSchema": {
        "type": "object",
        "properties": {
          "intention_id": { "type": "string" }
        },
        "required": ["intention_id"]
      }
    }
  ]
}
```

### 3. ronald-gi-adhd (ADHD Support)

```json
{
  "name": "ronald-gi-adhd",
  "description": "ADHD-aware attention tracking, drive management, and proactive support",
  "tools": [
    {
      "name": "get_attention_state",
      "description": "Get the user's current attention/focus state",
      "outputSchema": {
        "type": "object",
        "properties": {
          "state": { "enum": ["focused", "hyperfocused", "scattered", "transitioning", "fatigued", "crashed"] },
          "confidence": { "type": "number" },
          "duration_minutes": { "type": "number" },
          "current_focus": { "type": "string" }
        }
      }
    },
    {
      "name": "record_attention_event",
      "description": "Record an attention-related event",
      "inputSchema": {
        "type": "object",
        "properties": {
          "type": { "enum": ["focus_start", "focus_end", "distraction", "break", "task_switch"] },
          "context": { "type": "string" }
        },
        "required": ["type"]
      }
    },
    {
      "name": "get_drives",
      "description": "Get current drive levels (focus, rest, novelty, completion, etc.)",
      "outputSchema": {
        "type": "object",
        "properties": {
          "drives": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "type": { "type": "string" },
                "level": { "type": "number" },
                "is_urgent": { "type": "boolean" }
              }
            }
          }
        }
      }
    },
    {
      "name": "satisfy_drive",
      "description": "Record that a drive was satisfied",
      "inputSchema": {
        "type": "object",
        "properties": {
          "drive_type": { "enum": ["focus", "rest", "novelty", "completion", "curiosity", "connection", "mastery"] },
          "action": { "type": "string" }
        },
        "required": ["drive_type", "action"]
      }
    },
    {
      "name": "get_suggestions",
      "description": "Get ADHD-aware suggestions based on current state",
      "outputSchema": {
        "type": "object",
        "properties": {
          "suggestions": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "type": { "type": "string" },
                "message": { "type": "string" },
                "priority": { "type": "number" }
              }
            }
          }
        }
      }
    },
    {
      "name": "generate_nudge",
      "description": "Generate an appropriate proactive nudge based on current state",
      "inputSchema": {
        "type": "object",
        "properties": {
          "context": { "type": "string" }
        }
      }
    }
  ],
  "prompts": [
    {
      "name": "adhd_context",
      "description": "Get ADHD-aware context prompt for conversations",
      "arguments": [
        { "name": "include_beliefs", "type": "boolean" },
        { "name": "include_drives", "type": "boolean" },
        { "name": "include_suggestions", "type": "boolean" }
      ]
    }
  ]
}
```

### 4. ronald-gi-graph (Knowledge Graph)

```json
{
  "name": "ronald-gi-graph",
  "description": "Knowledge graph for exploring relationships between memories and concepts",
  "tools": [
    {
      "name": "find_causes",
      "description": "Find what caused something",
      "inputSchema": {
        "type": "object",
        "properties": {
          "node_id": { "type": "string" },
          "max_depth": { "type": "integer", "default": 3 }
        },
        "required": ["node_id"]
      }
    },
    {
      "name": "find_effects",
      "description": "Find effects/consequences of something",
      "inputSchema": {
        "type": "object",
        "properties": {
          "node_id": { "type": "string" },
          "max_depth": { "type": "integer", "default": 3 }
        },
        "required": ["node_id"]
      }
    },
    {
      "name": "find_contradictions",
      "description": "Find beliefs that contradict a given belief",
      "inputSchema": {
        "type": "object",
        "properties": {
          "belief_id": { "type": "string" }
        },
        "required": ["belief_id"]
      }
    },
    {
      "name": "find_supporting_evidence",
      "description": "Find evidence that supports a belief",
      "inputSchema": {
        "type": "object",
        "properties": {
          "belief_id": { "type": "string" }
        },
        "required": ["belief_id"]
      }
    },
    {
      "name": "find_path",
      "description": "Find paths between two nodes",
      "inputSchema": {
        "type": "object",
        "properties": {
          "from_id": { "type": "string" },
          "to_id": { "type": "string" },
          "max_depth": { "type": "integer", "default": 5 }
        },
        "required": ["from_id", "to_id"]
      }
    },
    {
      "name": "explore_neighbors",
      "description": "Explore nodes connected to a given node",
      "inputSchema": {
        "type": "object",
        "properties": {
          "node_id": { "type": "string" },
          "depth": { "type": "integer", "default": 2 },
          "direction": { "enum": ["outgoing", "incoming", "both"], "default": "both" }
        },
        "required": ["node_id"]
      }
    }
  ]
}
```

## Claude Code Hooks Integration

```yaml
# .claude/hooks.yaml
hooks:
  on_conversation_start:
    - script: ronald-gi-context
      description: "Load user context at conversation start"

  on_message:
    - script: ronald-gi-record
      description: "Record attention events from messages"

  on_conversation_end:
    - script: ronald-gi-summarize
      description: "Summarize and store conversation memories"

  on_idle:
    - script: ronald-gi-heartbeat
      description: "Run heartbeat cycle when idle"
      interval: 900  # 15 minutes
```

## Implementation Plan

### Phase 1: Core MCP Servers
1. `ronald-gi-memory` - Memory storage and recall
2. `ronald-gi-user` - BDI user model

### Phase 2: ADHD Support
3. `ronald-gi-adhd` - Attention and drives
4. `ronald-gi-graph` - Knowledge relationships

### Phase 3: Integration
5. Claude Code hooks
6. Claude Desktop integration
7. Benchmark suite

## Benefits

1. **Reusability**: Same MCP servers work with Claude Code, Claude Desktop, or any MCP client
2. **Composability**: User can mix Ronald-GI MCPs with other MCP servers
3. **Updateability**: Update MCP servers without updating Claude
4. **Testability**: Claude can directly test the tools
5. **Portability**: Works on any platform Claude supports
6. **Simplicity**: Less custom code, more standard interfaces

## Example Usage in Claude

```
User: "What do you remember about my work patterns?"

Claude: [Uses ronald-gi-memory.recall("work patterns")]
        [Uses ronald-gi-user.get_beliefs(category="behavior")]
        [Uses ronald-gi-adhd.get_attention_state()]

Claude: "Based on my memories, I've observed that:
         - You tend to be most productive in the morning (belief, high confidence)
         - You often hyperfocus on coding tasks (observed 15 times)
         - Your current attention state suggests you might need a break soon

         Would you like me to suggest some strategies based on these patterns?"
```

This architecture makes Ronald-GI a **capability layer** for Claude rather than a separate application.
