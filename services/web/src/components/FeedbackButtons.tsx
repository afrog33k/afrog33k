'use client';

import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import clsx from 'clsx';
import { reportsStore } from '@/stores/reports';
import { api } from '@/lib/api';

interface Props {
  reportId: string;
}

const actionConfig: Record<string, { label: string; icon: string }> = {
  useful: { label: 'Useful', icon: '+' },
  not_useful: { label: 'Not useful', icon: '-' },
  more_depth: { label: 'Go deeper', icon: '>' },
  kill_thread: { label: 'Kill thread', icon: 'x' },
  revisit_later: { label: 'Revisit', icon: '~' },
};

export const FeedbackButtons = observer(({ reportId }: Props) => {
  useEffect(() => {
    reportsStore.loadUiActions();
  }, []);

  const handleFeedback = async (action: string) => {
    await reportsStore.sendFeedback(reportId, action);
  };

  const enabledActions = reportsStore.uiActions.filter((a) => a.enabled);

  // Show up to 5 actions, pruned by success rate
  const displayActions = enabledActions.slice(0, 5);

  useEffect(() => {
    // Track that actions were shown
    displayActions.forEach((action) => {
      api.markActionShown(action.action).catch(console.error);
    });
  }, [displayActions.length]);

  if (displayActions.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {displayActions.map((action) => {
        const config = actionConfig[action.action] || { label: action.action, icon: '?' };
        return (
          <button
            key={action.action}
            onClick={() => handleFeedback(action.action)}
            className={clsx(
              'px-3 py-1.5 rounded text-sm transition-colors',
              'bg-surface-overlay border border-white/5',
              'hover:bg-white/5 hover:border-white/10',
              'text-text-secondary hover:text-text-primary'
            )}
          >
            <span className="font-mono mr-1.5 text-text-muted">{config.icon}</span>
            {config.label}
          </button>
        );
      })}
    </div>
  );
});
