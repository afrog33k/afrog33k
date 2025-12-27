'use client';

import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import Link from 'next/link';
import { reportsStore } from '@/stores/reports';
import { ReportCard } from '@/components/ReportCard';
import { StatsBar } from '@/components/StatsBar';
import { FeedbackButtons } from '@/components/FeedbackButtons';

const HomePage = observer(() => {
  useEffect(() => {
    reportsStore.loadHome();
  }, []);

  const { top3, relevancePick, isLoading, error } = reportsStore;
  const allCards = [...top3, ...(relevancePick ? [relevancePick] : [])];

  return (
    <div className="space-y-8">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Ronald-GI</h1>
          <p className="text-sm text-text-secondary mt-1">Your research colleague</p>
        </div>
        <nav className="flex items-center gap-4">
          <Link
            href="/all"
            className="text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            All Cards
          </Link>
          <StatsBar />
        </nav>
      </header>

      {/* Loading / Error states */}
      {isLoading && (
        <div className="text-center py-12 text-text-muted">Loading...</div>
      )}

      {error && (
        <div className="text-center py-12 text-watchlist">
          Error: {error}
        </div>
      )}

      {/* 3+1 Stack */}
      {!isLoading && !error && (
        <div className="space-y-6">
          {/* Top 3 */}
          {top3.map((report) => (
            <div key={report.id} className="space-y-3">
              <ReportCard report={report} />
              <FeedbackButtons reportId={report.id} />
            </div>
          ))}

          {/* +1 Relevance Pick */}
          {relevancePick && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs text-text-muted pt-4">
                <div className="h-px flex-1 bg-white/5" />
                <span>based on your current focus</span>
                <div className="h-px flex-1 bg-white/5" />
              </div>
              <ReportCard report={relevancePick} isRelevancePick />
              <FeedbackButtons reportId={relevancePick.id} />
            </div>
          )}

          {/* Empty state */}
          {allCards.length === 0 && (
            <div className="text-center py-16 text-text-muted">
              <p className="text-lg mb-2">No reports yet</p>
              <p className="text-sm">
                The worker will generate reports as it processes your sources and history.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export default HomePage;
