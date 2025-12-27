'use client';

import { LinkListBlock } from './types';

interface Props {
  block: LinkListBlock;
  onLinkClick?: (url: string) => void;
}

export const LinkList = ({ block, onLinkClick }: Props) => {
  return (
    <div className="space-y-2">
      {block.title && (
        <h4 className="text-sm font-medium text-text-primary">{block.title}</h4>
      )}
      <div className="space-y-2">
        {block.items.map((item, i) => (
          <a
            key={i}
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onLinkClick?.(item.url)}
            className="block p-3 rounded-lg bg-surface-raised border border-white/5 hover:border-white/10 transition-colors group"
          >
            <div className="flex items-start gap-3">
              {item.favicon && (
                <img
                  src={item.favicon}
                  alt=""
                  className="w-4 h-4 mt-0.5 rounded"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-accent group-hover:underline truncate">
                  {item.title}
                </div>
                {item.description && (
                  <p className="text-xs text-text-muted mt-1 line-clamp-2">
                    {item.description}
                  </p>
                )}
                <span className="text-xs text-text-muted opacity-50">
                  {new URL(item.url).hostname}
                </span>
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
};
