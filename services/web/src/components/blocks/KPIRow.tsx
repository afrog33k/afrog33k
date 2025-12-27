'use client';

import clsx from 'clsx';
import { KPIRowBlock, KPIItem } from './types';

interface Props {
  block: KPIRowBlock;
}

const TrendIcon = ({ trend }: { trend?: 'up' | 'down' | 'neutral' }) => {
  if (trend === 'up') {
    return (
      <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
      </svg>
    );
  }
  if (trend === 'down') {
    return (
      <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
      </svg>
    );
  }
  return null;
};

export const KPIRow = ({ block }: Props) => {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-surface-raised rounded-lg border border-white/5">
      {block.items.map((item, i) => (
        <div key={i} className="text-center">
          <div className="text-xs text-text-muted uppercase tracking-wide mb-1">
            {item.label}
          </div>
          <div className="flex items-center justify-center gap-1">
            <span className="text-2xl font-bold text-text-primary">
              {item.value}
            </span>
            <TrendIcon trend={item.trend} />
          </div>
          {item.delta && (
            <div className={clsx(
              'text-xs mt-1',
              item.trend === 'up' && 'text-green-400',
              item.trend === 'down' && 'text-red-400',
              item.trend === 'neutral' && 'text-text-muted'
            )}>
              {item.delta}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
