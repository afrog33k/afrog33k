'use client';

import { UIBlock } from './types';
import { KPIRow } from './KPIRow';
import { BulletList } from './BulletList';
import { LinkList } from './LinkList';
import { CodeBlock } from './CodeBlock';
import { NoteBlock } from './NoteBlock';

interface Props {
  blocks: UIBlock[];
  onLinkClick?: (url: string) => void;
}

export const BlockRenderer = ({ blocks, onLinkClick }: Props) => {
  if (!blocks || blocks.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {blocks.map((block, index) => {
        const key = block.id || `block-${index}`;

        switch (block.type) {
          case 'kpi_row':
            return <KPIRow key={key} block={block} />;
          case 'bullet_list':
            return <BulletList key={key} block={block} />;
          case 'link_list':
            return <LinkList key={key} block={block} onLinkClick={onLinkClick} />;
          case 'code':
            return <CodeBlock key={key} block={block} />;
          case 'note':
            return <NoteBlock key={key} block={block} />;
          case 'quote':
            return (
              <blockquote
                key={key}
                className="border-l-2 border-accent/50 pl-4 py-2 text-text-secondary italic"
              >
                <p>{block.text}</p>
                {block.source && (
                  <cite className="text-xs text-text-muted not-italic mt-2 block">
                    {block.url ? (
                      <a href={block.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                        {block.source}
                      </a>
                    ) : (
                      block.source
                    )}
                  </cite>
                )}
              </blockquote>
            );
          case 'table':
            return (
              <div key={key} className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      {block.headers.map((header, i) => (
                        <th key={i} className="px-3 py-2 text-left font-medium text-text-primary">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, i) => (
                      <tr key={i} className="border-b border-white/5">
                        {row.map((cell, j) => (
                          <td key={j} className="px-3 py-2 text-text-secondary">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
};
