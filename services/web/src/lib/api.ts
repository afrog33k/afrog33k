const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

async function fetcher<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `HTTP ${res.status}`);
  }

  return res.json();
}

export const api = {
  // Reports
  getHomeReports: () => fetcher<{ top3: Report[]; relevancePick: Report | null }>('/reports/home'),
  getReports: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return fetcher<{ reports: Report[]; total: number }>(`/reports${qs}`);
  },
  getReport: (id: string) => fetcher<Report>(`/reports/${id}`),
  pinReport: (id: string) => fetcher(`/reports/${id}/pin`, { method: 'POST' }),
  unpinReport: (id: string) => fetcher(`/reports/${id}/unpin`, { method: 'POST' }),

  // Telemetry
  sendTelemetry: (event: TelemetryEvent) =>
    fetcher('/telemetry', { method: 'POST', body: JSON.stringify(event) }),
  sendFeedback: (feedback: Feedback) =>
    fetcher('/feedback', { method: 'POST', body: JSON.stringify(feedback) }),
  getUiActions: () => fetcher<{ actions: UiAction[] }>('/ui-actions'),
  markActionShown: (action: string) =>
    fetcher(`/ui-actions/${action}/shown`, { method: 'POST' }),

  // System
  getStats: () => fetcher<SystemStats>('/system/stats'),
};

// Types
export interface Report {
  id: string;
  type: 'decision_memo' | 'research_brief' | 'repo_signal' | 'concept_drift' | 'watchlist_alert';
  title: string;
  summary: string | null;
  findings_json: string;
  decision: string | null;
  next_actions_json: string;
  evidence_json: string;
  ui_blocks_json: string;
  concept_ids_json: string;
  impact_score: number;
  novelty_score: number;
  relevance_score: number;
  blended_score: number;
  pinned: number;
  promoted: number;
  archived: number;
  created_at: string;
  updated_at: string;
}

export interface TelemetryEvent {
  report_id: string;
  event_type: 'open' | 'close' | 'dwell' | 'scroll' | 'click' | 'pin';
  event_data_json?: string;
}

export interface Feedback {
  report_id: string;
  action: string;
  comment?: string;
}

export interface UiAction {
  action: string;
  enabled: number;
  shown_count: number;
  clicked_count: number;
  success_rate: number;
}

export interface SystemStats {
  reports: number;
  sources: number;
  visits: number;
  clusters: number;
  concepts: number;
  pendingJobs: number;
}
