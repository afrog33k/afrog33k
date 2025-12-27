'use client';

import { useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import clsx from 'clsx';
import { Report } from '@/lib/api';
import { reportsStore } from '@/stores/reports';
import { telemetryStore } from '@/stores/telemetry';

interface Props {
  report: Report;
  variant?: 'compact' | 'full';
  isRelevancePick?: boolean;
}

const typeConfig = {
  decision_memo: { label: 'Decision', color: 'bg-decision', icon: '>' },
  research_brief: { label: 'Research', color: 'bg-research', icon: '?' },
  repo_signal: { label: 'Repo', color: 'bg-repo', icon: '@' },
  concept_drift: { label: 'Drift', color: 'bg-drift', icon: '~' },
  watchlist_alert: { label: 'Alert', color: 'bg-watchlist', icon: '!' },
};

export const ReportCard = observer(({ report, variant = 'compact', isRelevancePick }: Props) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const config = typeConfig[report.type];

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            telemetryStore.trackOpen(report.id);
          } else {
            telemetryStore.trackClose(report.id);
          }
        });
      },
      { threshold: 0.5 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [report.id]);

  const handlePin = async () => {
    if (report.pinned) {
      await reportsStore.unpinReport(report.id);
    } else {
      await reportsStore.pinReport(report.id);
      telemetryStore.trackPin(report.id);
    }
  };

  const findings = JSON.parse(report.findings_json || '[]');
  const evidence = JSON.parse(report.evidence_json || '[]');

  return (
    <div
      ref={cardRef}
      className={clsx(
        'group relative rounded-lg border transition-all',
        'bg-surface-raised border-white/5 hover:border-white/10',
        isRelevancePick && 'ring-1 ring-accent/30'
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between p-4 pb-2">
        <div className="flex items-center gap-2">
          <span className={clsx('px-2 py-0.5 text-xs font-medium rounded', config.color, 'text-black')}>
            {config.label}
          </span>
          {report.pinned === 1 && (
            <span className="text-xs text-text-muted">pinned</span>
          )}
          {isRelevancePick && (
            <span className="text-xs text-accent">+1 relevance</span>
          )}
        </div>

        <button
          onClick={handlePin}
          className={clsx(
            'p-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity',
            'hover:bg-white/5',
            report.pinned && 'opacity-100 text-accent'
          )}
          title={report.pinned ? 'Unpin' : 'Pin'}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
            />
          </svg>
        </button>
      </div>

      {/* Title */}
      <h3 className="px-4 text-lg font-medium text-text-primary leading-tight">
        {report.title}
      </h3>

      {/* Summary */}
      {report.summary && (
        <p className="px-4 mt-2 text-sm text-text-secondary line-clamp-2">
          {report.summary}
        </p>
      )}

      {/* Decision (for decision memos) */}
      {report.decision && (
        <div className="mx-4 mt-3 p-3 rounded bg-decision/10 border border-decision/20">
          <p className="text-sm text-decision font-medium">{report.decision}</p>
        </div>
      )}

      {/* Findings (abbreviated in compact mode) */}
      {variant === 'full' && findings.length > 0 && (
        <ul className="px-4 mt-3 space-y-1">
          {findings.map((finding: string, i: number) => (
            <li key={i} className="text-sm text-text-secondary flex items-start gap-2">
              <span className="text-text-muted">-</span>
              <span>{finding}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Evidence links */}
      {evidence.length > 0 && (
        <div className="px-4 mt-3 flex flex-wrap gap-2">
          {evidence.slice(0, 3).map((e: { url: string; title: string }, i: number) => (
            <a
              key={i}
              href={e.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => telemetryStore.trackClick(report.id, e.url)}
              className="text-xs text-accent hover:underline truncate max-w-[200px]"
            >
              {e.title || e.url}
            </a>
          ))}
          {evidence.length > 3 && (
            <span className="text-xs text-text-muted">+{evidence.length - 3} more</span>
          )}
        </div>
      )}

      {/* Scores */}
      <div className="flex items-center gap-4 px-4 py-3 mt-2 border-t border-white/5 text-xs text-text-muted">
        <span>Impact: {(report.impact_score * 100).toFixed(0)}%</span>
        <span>Novelty: {(report.novelty_score * 100).toFixed(0)}%</span>
        <span className="ml-auto">{new Date(report.created_at).toLocaleDateString()}</span>
      </div>
    </div>
  );
});
