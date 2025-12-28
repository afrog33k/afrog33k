/**
 * Working Memory for Ronald-GI
 *
 * Inspired by QuixiAI's AGI Memory system.
 *
 * Working memory provides temporary storage with automatic expiry,
 * similar to human short-term memory. Used for:
 * - In-flight conversation context
 * - Temporary scratchpad for reasoning
 * - Pending actions awaiting confirmation
 *
 * Key Features:
 * - Auto-expiry based on TTL
 * - Priority-based retrieval
 * - Capacity limits (to prevent bloat)
 * - Type-based filtering
 */

import type { Database } from 'better-sqlite3';

// ============================================
// TYPES
// ============================================

export type WorkingMemoryType =
  | 'context'      // Conversation/session context
  | 'scratch'      // Temporary reasoning notes
  | 'pending'      // Actions awaiting execution
  | 'focus'        // Current focus/attention target
  | 'buffer';      // General short-term buffer

export interface WorkingMemoryItem {
  id: string;
  type: WorkingMemoryType;
  content: string;
  priority: number;           // 1-10, higher = more important
  ttlSeconds: number;         // Time to live
  createdAt: Date;
  expiresAt: Date;
  metadata: Record<string, any>;
}

export interface WorkingMemoryConfig {
  maxItems: number;           // Maximum items in working memory
  defaultTtlSeconds: number;  // Default TTL if not specified
  cleanupIntervalMs: number;  // How often to run cleanup
}

// ============================================
// WORKING MEMORY MANAGER
// ============================================

export class WorkingMemory {
  private config: WorkingMemoryConfig;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    private db: Database,
    config?: Partial<WorkingMemoryConfig>
  ) {
    this.config = {
      maxItems: config?.maxItems ?? 50,
      defaultTtlSeconds: config?.defaultTtlSeconds ?? 300, // 5 minutes
      cleanupIntervalMs: config?.cleanupIntervalMs ?? 60000, // 1 minute
    };
  }

  /**
   * Store an item in working memory
   */
  store(item: {
    type: WorkingMemoryType;
    content: string;
    priority?: number;
    ttlSeconds?: number;
    metadata?: Record<string, any>;
  }): string {
    // Cleanup expired items first
    this.cleanup();

    // Check capacity - evict lowest priority if full
    this.enforceCapacity();

    const id = `wm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date();
    const ttl = item.ttlSeconds ?? this.config.defaultTtlSeconds;
    const expiresAt = new Date(now.getTime() + ttl * 1000);

    this.db.prepare(`
      INSERT INTO working_memory (
        id, type, content, priority, ttl_seconds, created_at, expires_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      item.type,
      item.content,
      item.priority ?? 5,
      ttl,
      now.toISOString(),
      expiresAt.toISOString(),
      JSON.stringify(item.metadata ?? {})
    );

    return id;
  }

  /**
   * Retrieve items from working memory
   */
  retrieve(options?: {
    type?: WorkingMemoryType;
    minPriority?: number;
    limit?: number;
  }): WorkingMemoryItem[] {
    this.cleanup();

    let query = `
      SELECT * FROM working_memory
      WHERE expires_at > ?
    `;
    const params: (string | number)[] = [new Date().toISOString()];

    if (options?.type) {
      query += ` AND type = ?`;
      params.push(options.type);
    }

    if (options?.minPriority) {
      query += ` AND priority >= ?`;
      params.push(options.minPriority);
    }

    query += ` ORDER BY priority DESC, created_at DESC`;

    if (options?.limit) {
      query += ` LIMIT ?`;
      params.push(options.limit);
    }

    const rows = this.db.prepare(query).all(...params) as any[];

    return rows.map(row => ({
      id: row.id,
      type: row.type,
      content: row.content,
      priority: row.priority,
      ttlSeconds: row.ttl_seconds,
      createdAt: new Date(row.created_at),
      expiresAt: new Date(row.expires_at),
      metadata: JSON.parse(row.metadata_json || '{}'),
    }));
  }

  /**
   * Get a specific item by ID
   */
  get(id: string): WorkingMemoryItem | null {
    const row = this.db.prepare(`
      SELECT * FROM working_memory WHERE id = ? AND expires_at > ?
    `).get(id, new Date().toISOString()) as any;

    if (!row) return null;

    return {
      id: row.id,
      type: row.type,
      content: row.content,
      priority: row.priority,
      ttlSeconds: row.ttl_seconds,
      createdAt: new Date(row.created_at),
      expiresAt: new Date(row.expires_at),
      metadata: JSON.parse(row.metadata_json || '{}'),
    };
  }

  /**
   * Update an item's priority or extend its TTL
   */
  refresh(id: string, options?: {
    priority?: number;
    extendTtlSeconds?: number;
  }): boolean {
    const item = this.get(id);
    if (!item) return false;

    if (options?.priority !== undefined) {
      this.db.prepare(`UPDATE working_memory SET priority = ? WHERE id = ?`)
        .run(options.priority, id);
    }

    if (options?.extendTtlSeconds) {
      const newExpiry = new Date(Date.now() + options.extendTtlSeconds * 1000);
      this.db.prepare(`UPDATE working_memory SET expires_at = ? WHERE id = ?`)
        .run(newExpiry.toISOString(), id);
    }

    return true;
  }

  /**
   * Remove a specific item
   */
  remove(id: string): boolean {
    const result = this.db.prepare(`DELETE FROM working_memory WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  /**
   * Clear all items of a specific type
   */
  clearType(type: WorkingMemoryType): number {
    const result = this.db.prepare(`DELETE FROM working_memory WHERE type = ?`).run(type);
    return result.changes;
  }

  /**
   * Clear all working memory
   */
  clearAll(): number {
    const result = this.db.prepare(`DELETE FROM working_memory`).run();
    return result.changes;
  }

  /**
   * Get current focus (highest priority 'focus' type item)
   */
  getCurrentFocus(): WorkingMemoryItem | null {
    const items = this.retrieve({ type: 'focus', limit: 1 });
    return items[0] || null;
  }

  /**
   * Set current focus (replaces previous)
   */
  setFocus(content: string, ttlSeconds: number = 1800): string {
    // Clear existing focus
    this.clearType('focus');

    return this.store({
      type: 'focus',
      content,
      priority: 10,
      ttlSeconds,
    });
  }

  /**
   * Get pending actions
   */
  getPendingActions(): WorkingMemoryItem[] {
    return this.retrieve({ type: 'pending' });
  }

  /**
   * Add a pending action
   */
  addPendingAction(action: string, metadata?: Record<string, any>): string {
    return this.store({
      type: 'pending',
      content: action,
      priority: 7,
      ttlSeconds: 3600, // 1 hour
      metadata,
    });
  }

  /**
   * Get statistics about working memory
   */
  getStats(): {
    total: number;
    byType: Record<string, number>;
    avgPriority: number;
    oldestAge: number; // seconds
  } {
    const rows = this.db.prepare(`
      SELECT * FROM working_memory WHERE expires_at > ?
    `).all(new Date().toISOString()) as any[];

    const byType: Record<string, number> = {};
    let totalPriority = 0;
    let oldestAge = 0;
    const now = Date.now();

    for (const row of rows) {
      byType[row.type] = (byType[row.type] || 0) + 1;
      totalPriority += row.priority;
      const age = (now - new Date(row.created_at).getTime()) / 1000;
      if (age > oldestAge) oldestAge = age;
    }

    return {
      total: rows.length,
      byType,
      avgPriority: rows.length > 0 ? totalPriority / rows.length : 0,
      oldestAge,
    };
  }

  /**
   * Cleanup expired items
   */
  cleanup(): number {
    const result = this.db.prepare(`
      DELETE FROM working_memory WHERE expires_at <= ?
    `).run(new Date().toISOString());
    return result.changes;
  }

  /**
   * Enforce capacity limit by evicting lowest priority items
   */
  private enforceCapacity(): void {
    const count = this.db.prepare(`
      SELECT COUNT(*) as count FROM working_memory WHERE expires_at > ?
    `).get(new Date().toISOString()) as any;

    if (count.count >= this.config.maxItems) {
      // Evict lowest priority items
      const toEvict = count.count - this.config.maxItems + 1;
      this.db.prepare(`
        DELETE FROM working_memory
        WHERE id IN (
          SELECT id FROM working_memory
          WHERE expires_at > ?
          ORDER BY priority ASC, created_at ASC
          LIMIT ?
        )
      `).run(new Date().toISOString(), toEvict);
    }
  }

  /**
   * Start automatic cleanup timer
   */
  startAutoCleanup(): void {
    if (this.cleanupTimer) return;

    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupIntervalMs);
  }

  /**
   * Stop automatic cleanup timer
   */
  stopAutoCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }
}

// ============================================
// CONTEXT BUILDER
// ============================================

/**
 * Builds context from working memory for LLM prompts
 */
export class ContextBuilder {
  constructor(private workingMemory: WorkingMemory) {}

  /**
   * Build a context string from current working memory
   */
  build(options?: {
    maxTokens?: number;
    includeTypes?: WorkingMemoryType[];
    minPriority?: number;
  }): string {
    const items = this.workingMemory.retrieve({
      minPriority: options?.minPriority ?? 3,
    });

    // Filter by type if specified
    const filtered = options?.includeTypes
      ? items.filter(i => options.includeTypes!.includes(i.type))
      : items;

    // Build context sections
    const sections: string[] = [];

    // Current focus
    const focus = filtered.find(i => i.type === 'focus');
    if (focus) {
      sections.push(`Current Focus: ${focus.content}`);
    }

    // Pending actions
    const pending = filtered.filter(i => i.type === 'pending');
    if (pending.length > 0) {
      sections.push(`Pending Actions:\n${pending.map(p => `- ${p.content}`).join('\n')}`);
    }

    // Context items
    const context = filtered.filter(i => i.type === 'context');
    if (context.length > 0) {
      sections.push(`Context:\n${context.map(c => `- ${c.content}`).join('\n')}`);
    }

    // Scratch notes
    const scratch = filtered.filter(i => i.type === 'scratch');
    if (scratch.length > 0) {
      sections.push(`Notes:\n${scratch.map(s => `- ${s.content}`).join('\n')}`);
    }

    const result = sections.join('\n\n');

    // Truncate if needed (rough token estimate: 4 chars per token)
    if (options?.maxTokens) {
      const maxChars = options.maxTokens * 4;
      if (result.length > maxChars) {
        return result.substring(0, maxChars) + '...';
      }
    }

    return result;
  }
}

// ============================================
// EXPORTS
// ============================================

export default {
  WorkingMemory,
  ContextBuilder,
};
