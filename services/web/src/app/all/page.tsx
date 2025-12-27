'use client';

import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import Link from 'next/link';
import clsx from 'clsx';
import { reportsStore } from '@/stores/reports';
import { ReportCard } from '@/components/ReportCard';
import { StatsBar } from '@/components/StatsBar';

const sortOptions = [
  { value: 'blended_score', label: 'Blended' },
  { value: 'newest', label: 'Newest' },
  { value: 'impact', label: 'Impact' },
  { value: 'novelty', label: 'Novelty' },
  { value: 'relevance', label: 'Relevance' },
];

const typeOptions = [
  { value: '', label: 'All types' },
  { value: 'decision_memo', label: 'Decision' },
  { value: 'research_brief', label: 'Research' },
  { value: 'repo_signal', label: 'Repo' },
  { value: 'concept_drift', label: 'Drift' },
  { value: 'watchlist_alert', label: 'Alert' },
];

const AllCardsPage = observer(() => {
  useEffect(() => {
    reportsStore.loadAllReports();
  }, [reportsStore.filter.sort, reportsStore.filter.type, reportsStore.filter.pinned]);

  const { allReports, totalReports, isLoading, filter } = reportsStore;

  return (
    <div className="space-y-8">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="text-text-muted hover:text-text-primary transition-colors"
          >
            &larr;
          </Link>
          <div>
            <h1 className="text-2xl font-semibold">All Cards</h1>
            <p className="text-sm text-text-secondary mt-1">
              {totalReports} reports total
            </p>
          </div>
        </div>
        <StatsBar />
      </header>

      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        {/* Sort */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">Sort:</span>
          <div className="flex gap-1">
            {sortOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => reportsStore.setFilter('sort', opt.value)}
                className={clsx(
                  'px-2 py-1 text-xs rounded transition-colors',
                  filter.sort === opt.value
                    ? 'bg-accent text-black'
                    : 'bg-surface-overlay text-text-secondary hover:text-text-primary'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Type filter */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">Type:</span>
          <select
            value={filter.type}
            onChange={(e) => reportsStore.setFilter('type', e.target.value)}
            className="bg-surface-overlay text-text-primary text-xs px-2 py-1 rounded border border-white/5"
          >
            {typeOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Pinned filter */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">Show:</span>
          <div className="flex gap-1">
            {[
              { value: '', label: 'All' },
              { value: '1', label: 'Pinned' },
              { value: '0', label: 'Unpinned' },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => reportsStore.setFilter('pinned', opt.value)}
                className={clsx(
                  'px-2 py-1 text-xs rounded transition-colors',
                  filter.pinned === opt.value
                    ? 'bg-accent text-black'
                    : 'bg-surface-overlay text-text-secondary hover:text-text-primary'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="text-center py-12 text-text-muted">Loading...</div>
      )}

      {/* Reports grid */}
      {!isLoading && (
        <div className="space-y-4">
          {allReports.map((report) => (
            <ReportCard key={report.id} report={report} />
          ))}

          {allReports.length === 0 && (
            <div className="text-center py-16 text-text-muted">
              <p>No reports match your filters</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export default AllCardsPage;
