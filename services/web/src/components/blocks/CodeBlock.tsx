'use client';

import { useState } from 'react';
import { CodeBlock as CodeBlockType } from './types';

interface Props {
  block: CodeBlockType;
}

export const CodeBlock = ({ block }: Props) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(block.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-lg bg-[#1a1a1a] border border-white/5 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-white/5 border-b border-white/5">
        <div className="flex items-center gap-2">
          {block.filename && (
            <span className="text-xs text-text-muted">{block.filename}</span>
          )}
          {block.language && (
            <span className="text-xs text-text-muted px-1.5 py-0.5 rounded bg-white/5">
              {block.language}
            </span>
          )}
        </div>
        <button
          onClick={handleCopy}
          className="text-xs text-text-muted hover:text-text-secondary transition-colors"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      {/* Code */}
      <pre className="p-4 overflow-x-auto">
        <code className="text-sm text-text-secondary font-mono">
          {block.code}
        </code>
      </pre>
    </div>
  );
};
