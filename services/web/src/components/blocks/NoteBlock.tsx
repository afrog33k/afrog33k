'use client';

import clsx from 'clsx';
import { NoteBlock as NoteBlockType } from './types';

interface Props {
  block: NoteBlockType;
}

const variantStyles = {
  info: {
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/20',
    icon: 'text-blue-400',
    iconPath: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  },
  warning: {
    bg: 'bg-yellow-500/10',
    border: 'border-yellow-500/20',
    icon: 'text-yellow-400',
    iconPath: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
  },
  success: {
    bg: 'bg-green-500/10',
    border: 'border-green-500/20',
    icon: 'text-green-400',
    iconPath: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  },
  error: {
    bg: 'bg-red-500/10',
    border: 'border-red-500/20',
    icon: 'text-red-400',
    iconPath: 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z',
  },
};

export const NoteBlock = ({ block }: Props) => {
  const style = variantStyles[block.variant];

  return (
    <div className={clsx('rounded-lg p-4 border', style.bg, style.border)}>
      <div className="flex gap-3">
        <svg
          className={clsx('w-5 h-5 flex-shrink-0 mt-0.5', style.icon)}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d={style.iconPath}
          />
        </svg>
        <div className="flex-1">
          {block.title && (
            <h4 className="text-sm font-medium text-text-primary mb-1">
              {block.title}
            </h4>
          )}
          <p className="text-sm text-text-secondary">{block.content}</p>
        </div>
      </div>
    </div>
  );
};
