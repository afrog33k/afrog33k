#!/usr/bin/env node
/**
 * Ronald-GI Memory MCP Server
 *
 * Provides persistent memory capabilities for Claude through MCP.
 * Implements: remember, recall, recall_recent, forget, connect
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  Tool,
  TextContent,
} from '@modelcontextprotocol/sdk/types.js';
import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';

// =============================================================================
// Configuration
// =============================================================================

const DATA_DIR = process.env.RONALD_GI_DATA_DIR || join(homedir(), '.ronald-gi');
const DB_PATH = join(DATA_DIR, 'memory.db');

// Ensure data directory exists
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

// =============================================================================
// Database Schema
// =============================================================================

const SCHEMA = `
  -- Core memories table
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'semantic',
    importance REAL DEFAULT 0.5,
    source TEXT,
    embedding_blob BLOB,
    access_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_accessed TEXT,
    metadata_json TEXT DEFAULT '{}'
  );

  -- Memory relationships
  CREATE TABLE IF NOT EXISTS memory_edges (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    relationship TEXT NOT NULL,
    strength REAL DEFAULT 0.5,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (source_id) REFERENCES memories(id) ON DELETE CASCADE,
    FOREIGN KEY (target_id) REFERENCES memories(id) ON DELETE CASCADE,
    UNIQUE(source_id, target_id, relationship)
  );

  -- Indexes
  CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
  CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);
  CREATE INDEX IF NOT EXISTS idx_edges_source ON memory_edges(source_id);
  CREATE INDEX IF NOT EXISTS idx_edges_target ON memory_edges(target_id);
`;

// =============================================================================
// Database Initialization
// =============================================================================

const db = new Database(DB_PATH);
db.exec(SCHEMA);

// =============================================================================
// Helper Functions
// =============================================================================

function generateId(): string {
  return `mem_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

interface Memory {
  id: string;
  content: string;
  type: string;
  importance: number;
  source?: string;
  access_count: number;
  created_at: string;
  last_accessed?: string;
  metadata: Record<string, unknown>;
}

function rowToMemory(row: Record<string, unknown>): Memory {
  return {
    id: row.id as string,
    content: row.content as string,
    type: row.type as string,
    importance: row.importance as number,
    source: row.source as string | undefined,
    access_count: row.access_count as number,
    created_at: row.created_at as string,
    last_accessed: row.last_accessed as string | undefined,
    metadata: JSON.parse((row.metadata_json as string) || '{}'),
  };
}

// Simple text similarity (word overlap)
function textSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = new Set([...wordsA].filter((x) => wordsB.has(x)));
  const union = new Set([...wordsA, ...wordsB]);
  return intersection.size / union.size;
}

// =============================================================================
// Tool Definitions
// =============================================================================

const TOOLS: Tool[] = [
  {
    name: 'remember',
    description:
      'Store information in long-term memory. Use this to save important facts, observations, or learned information about the user.',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The information to remember',
        },
        type: {
          type: 'string',
          enum: ['episodic', 'semantic', 'procedural'],
          default: 'semantic',
          description:
            'Type of memory: episodic (events), semantic (facts), procedural (how-to)',
        },
        importance: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          default: 0.5,
          description: 'How important this memory is (0-1)',
        },
        source: {
          type: 'string',
          description: 'Where this information came from (stated, observed, inferred)',
        },
        metadata: {
          type: 'object',
          description: 'Additional metadata to store with the memory',
        },
      },
      required: ['content'],
    },
  },
  {
    name: 'recall',
    description:
      'Search memories by content similarity. Use this to find relevant information from past interactions.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What to search for',
        },
        limit: {
          type: 'integer',
          default: 5,
          description: 'Maximum number of memories to return',
        },
        type: {
          type: 'string',
          enum: ['episodic', 'semantic', 'procedural', 'all'],
          default: 'all',
          description: 'Filter by memory type',
        },
        min_importance: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          default: 0,
          description: 'Minimum importance threshold',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'recall_recent',
    description: 'Get the most recently created or accessed memories.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          default: 10,
          description: 'Number of memories to return',
        },
        hours: {
          type: 'integer',
          description: 'Only return memories from the last N hours',
        },
        by_access: {
          type: 'boolean',
          default: false,
          description: 'Sort by last accessed instead of created',
        },
      },
    },
  },
  {
    name: 'forget',
    description:
      'Remove a memory by ID. Use sparingly - forgetting is usually not needed.',
    inputSchema: {
      type: 'object',
      properties: {
        memory_id: {
          type: 'string',
          description: 'The ID of the memory to remove',
        },
      },
      required: ['memory_id'],
    },
  },
  {
    name: 'connect',
    description:
      'Create a relationship between two memories. Use to build knowledge graph connections.',
    inputSchema: {
      type: 'object',
      properties: {
        from_id: {
          type: 'string',
          description: 'Source memory ID',
        },
        to_id: {
          type: 'string',
          description: 'Target memory ID',
        },
        relationship: {
          type: 'string',
          enum: ['CAUSES', 'CONTRADICTS', 'SUPPORTS', 'RELATED', 'DERIVED_FROM'],
          description: 'Type of relationship',
        },
        strength: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          default: 0.5,
          description: 'Strength of the relationship',
        },
      },
      required: ['from_id', 'to_id', 'relationship'],
    },
  },
  {
    name: 'get_connections',
    description: 'Get all connections for a memory.',
    inputSchema: {
      type: 'object',
      properties: {
        memory_id: {
          type: 'string',
          description: 'Memory ID to get connections for',
        },
        direction: {
          type: 'string',
          enum: ['outgoing', 'incoming', 'both'],
          default: 'both',
          description: 'Direction of connections to retrieve',
        },
      },
      required: ['memory_id'],
    },
  },
];

// =============================================================================
// Tool Handlers
// =============================================================================

function handleRemember(args: {
  content: string;
  type?: string;
  importance?: number;
  source?: string;
  metadata?: Record<string, unknown>;
}): string {
  const id = generateId();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO memories (id, content, type, importance, source, created_at, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    args.content,
    args.type || 'semantic',
    args.importance ?? 0.5,
    args.source || null,
    now,
    JSON.stringify(args.metadata || {})
  );

  return JSON.stringify({
    success: true,
    memory_id: id,
    message: `Remembered: "${args.content.substring(0, 50)}..."`,
  });
}

function handleRecall(args: {
  query: string;
  limit?: number;
  type?: string;
  min_importance?: number;
}): string {
  const limit = args.limit || 5;
  const minImportance = args.min_importance || 0;

  let query = 'SELECT * FROM memories WHERE importance >= ?';
  const params: (string | number)[] = [minImportance];

  if (args.type && args.type !== 'all') {
    query += ' AND type = ?';
    params.push(args.type);
  }

  query += ' ORDER BY created_at DESC';

  const rows = db.prepare(query).all(...params) as Record<string, unknown>[];

  // Calculate similarity and sort
  const results = rows
    .map((row) => {
      const memory = rowToMemory(row);
      const similarity = textSimilarity(args.query, memory.content);
      return { ...memory, similarity };
    })
    .filter((m) => m.similarity > 0.1)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);

  // Update access counts
  const now = new Date().toISOString();
  for (const result of results) {
    db.prepare(
      'UPDATE memories SET access_count = access_count + 1, last_accessed = ? WHERE id = ?'
    ).run(now, result.id);
  }

  return JSON.stringify({
    query: args.query,
    count: results.length,
    memories: results,
  });
}

function handleRecallRecent(args: {
  limit?: number;
  hours?: number;
  by_access?: boolean;
}): string {
  const limit = args.limit || 10;
  const orderBy = args.by_access ? 'last_accessed' : 'created_at';

  let query = `SELECT * FROM memories`;
  const params: (string | number)[] = [];

  if (args.hours) {
    query += ` WHERE ${orderBy} >= datetime('now', '-${args.hours} hours')`;
  }

  query += ` ORDER BY ${orderBy} DESC NULLS LAST LIMIT ?`;
  params.push(limit);

  const rows = db.prepare(query).all(...params) as Record<string, unknown>[];
  const memories = rows.map(rowToMemory);

  return JSON.stringify({
    count: memories.length,
    memories,
  });
}

function handleForget(args: { memory_id: string }): string {
  const result = db.prepare('DELETE FROM memories WHERE id = ?').run(args.memory_id);

  return JSON.stringify({
    success: result.changes > 0,
    message:
      result.changes > 0
        ? `Forgot memory ${args.memory_id}`
        : `Memory ${args.memory_id} not found`,
  });
}

function handleConnect(args: {
  from_id: string;
  to_id: string;
  relationship: string;
  strength?: number;
}): string {
  const id = `edge_${args.from_id}_${args.relationship}_${args.to_id}`;
  const now = new Date().toISOString();

  try {
    db.prepare(
      `INSERT OR REPLACE INTO memory_edges (id, source_id, target_id, relationship, strength, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, args.from_id, args.to_id, args.relationship, args.strength ?? 0.5, now);

    return JSON.stringify({
      success: true,
      edge_id: id,
      message: `Connected ${args.from_id} -[${args.relationship}]-> ${args.to_id}`,
    });
  } catch (error) {
    return JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

function handleGetConnections(args: {
  memory_id: string;
  direction?: string;
}): string {
  const direction = args.direction || 'both';
  const connections: Array<{
    edge_id: string;
    relationship: string;
    strength: number;
    direction: string;
    connected_memory: Memory;
  }> = [];

  if (direction === 'outgoing' || direction === 'both') {
    const rows = db
      .prepare(
        `SELECT e.*, m.*
         FROM memory_edges e
         JOIN memories m ON e.target_id = m.id
         WHERE e.source_id = ?`
      )
      .all(args.memory_id) as Record<string, unknown>[];

    for (const row of rows) {
      connections.push({
        edge_id: row.id as string,
        relationship: row.relationship as string,
        strength: row.strength as number,
        direction: 'outgoing',
        connected_memory: rowToMemory(row),
      });
    }
  }

  if (direction === 'incoming' || direction === 'both') {
    const rows = db
      .prepare(
        `SELECT e.*, m.*
         FROM memory_edges e
         JOIN memories m ON e.source_id = m.id
         WHERE e.target_id = ?`
      )
      .all(args.memory_id) as Record<string, unknown>[];

    for (const row of rows) {
      connections.push({
        edge_id: row.id as string,
        relationship: row.relationship as string,
        strength: row.strength as number,
        direction: 'incoming',
        connected_memory: rowToMemory(row),
      });
    }
  }

  return JSON.stringify({
    memory_id: args.memory_id,
    count: connections.length,
    connections,
  });
}

// =============================================================================
// MCP Server Setup
// =============================================================================

const server = new Server(
  {
    name: 'ronald-gi-memory',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// List tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  let result: string;

  switch (name) {
    case 'remember':
      result = handleRemember(args as Parameters<typeof handleRemember>[0]);
      break;
    case 'recall':
      result = handleRecall(args as Parameters<typeof handleRecall>[0]);
      break;
    case 'recall_recent':
      result = handleRecallRecent(args as Parameters<typeof handleRecallRecent>[0]);
      break;
    case 'forget':
      result = handleForget(args as Parameters<typeof handleForget>[0]);
      break;
    case 'connect':
      result = handleConnect(args as Parameters<typeof handleConnect>[0]);
      break;
    case 'get_connections':
      result = handleGetConnections(args as Parameters<typeof handleGetConnections>[0]);
      break;
    default:
      throw new Error(`Unknown tool: ${name}`);
  }

  return {
    content: [{ type: 'text', text: result } as TextContent],
  };
});

// List resources
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: 'memory://stats',
        name: 'Memory Statistics',
        description: 'Get memory system statistics',
        mimeType: 'application/json',
      },
    ],
  };
});

// Read resources
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  if (uri === 'memory://stats') {
    const memoryCount = (
      db.prepare('SELECT COUNT(*) as count FROM memories').get() as { count: number }
    ).count;
    const edgeCount = (
      db.prepare('SELECT COUNT(*) as count FROM memory_edges').get() as { count: number }
    ).count;
    const typeStats = db
      .prepare('SELECT type, COUNT(*) as count FROM memories GROUP BY type')
      .all() as Array<{ type: string; count: number }>;

    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(
            {
              total_memories: memoryCount,
              total_connections: edgeCount,
              by_type: Object.fromEntries(typeStats.map((t) => [t.type, t.count])),
              database_path: DB_PATH,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  throw new Error(`Unknown resource: ${uri}`);
});

// =============================================================================
// Start Server
// =============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Ronald-GI Memory MCP Server running...');
}

main().catch(console.error);
