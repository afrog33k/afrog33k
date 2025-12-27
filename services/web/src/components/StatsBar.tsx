'use client';

import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { reportsStore } from '@/stores/reports';

export const StatsBar = observer(() => {
  useEffect(() => {
    reportsStore.loadStats();
    const interval = setInterval(() => reportsStore.loadStats(), 30000);
    return () => clearInterval(interval);
  }, []);

  const stats = reportsStore.stats;

  if (!stats) return null;

  return (
    <div className="flex items-center gap-6 text-xs text-text-muted">
      <span>{stats.reports} reports</span>
      <span>{stats.sources} sources</span>
      <span>{stats.visits} visits</span>
      <span>{stats.concepts} concepts</span>
      {stats.pendingJobs > 0 && (
        <span className="text-accent">{stats.pendingJobs} jobs pending</span>
      )}
    </div>
  );
});
