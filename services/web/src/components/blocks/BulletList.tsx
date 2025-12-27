'use client';

import { BulletListBlock } from './types';

interface Props {
  block: BulletListBlock;
}

export const BulletList = ({ block }: Props) => {
  const ListTag = block.ordered ? 'ol' : 'ul';

  return (
    <div className="space-y-2">
      {block.title && (
        <h4 className="text-sm font-medium text-text-primary">{block.title}</h4>
      )}
      <ListTag className={block.ordered ? 'list-decimal list-inside space-y-1' : 'space-y-1'}>
        {block.items.map((item, i) => (
          <li key={i} className="text-sm text-text-secondary flex items-start gap-2">
            {!block.ordered && <span className="text-text-muted mt-0.5">-</span>}
            <span>{item}</span>
          </li>
        ))}
      </ListTag>
    </div>
  );
};
