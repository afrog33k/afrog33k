/**
 * A2UI Block Types
 * Adaptive Agent-to-User Interface blocks for rendering report content
 */

export type BlockType = 'kpi_row' | 'bullet_list' | 'link_list' | 'code' | 'note' | 'quote' | 'table';

export interface BaseBlock {
  type: BlockType;
  id?: string;
}

export interface KPIItem {
  label: string;
  value: string | number;
  trend?: 'up' | 'down' | 'neutral';
  delta?: string;
}

export interface KPIRowBlock extends BaseBlock {
  type: 'kpi_row';
  items: KPIItem[];
}

export interface BulletListBlock extends BaseBlock {
  type: 'bullet_list';
  title?: string;
  items: string[];
  ordered?: boolean;
}

export interface LinkItem {
  url: string;
  title: string;
  description?: string;
  favicon?: string;
}

export interface LinkListBlock extends BaseBlock {
  type: 'link_list';
  title?: string;
  items: LinkItem[];
}

export interface CodeBlock extends BaseBlock {
  type: 'code';
  language?: string;
  code: string;
  filename?: string;
}

export interface NoteBlock extends BaseBlock {
  type: 'note';
  variant: 'info' | 'warning' | 'success' | 'error';
  title?: string;
  content: string;
}

export interface QuoteBlock extends BaseBlock {
  type: 'quote';
  text: string;
  source?: string;
  url?: string;
}

export interface TableBlock extends BaseBlock {
  type: 'table';
  headers: string[];
  rows: string[][];
}

export type UIBlock =
  | KPIRowBlock
  | BulletListBlock
  | LinkListBlock
  | CodeBlock
  | NoteBlock
  | QuoteBlock
  | TableBlock;
