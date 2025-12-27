import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the api module
vi.mock('@/lib/api', () => ({
  api: {
    getHomeReports: vi.fn(),
    getReports: vi.fn(),
    pinReport: vi.fn(),
    unpinReport: vi.fn(),
    sendTelemetry: vi.fn(),
    sendFeedback: vi.fn(),
    getUiActions: vi.fn(),
    getStats: vi.fn(),
  },
}));

import { api } from '@/lib/api';

describe('ReportsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with empty state', async () => {
    const { reportsStore } = await import('@/stores/reports');

    expect(reportsStore.top3).toEqual([]);
    expect(reportsStore.relevancePick).toBeNull();
    expect(reportsStore.isLoading).toBe(false);
  });

  it('should load home reports', async () => {
    const mockReports = {
      top3: [
        {
          id: 'r1',
          type: 'decision_memo',
          title: 'Test',
          impact_score: 0.5,
          novelty_score: 0.5,
          relevance_score: 0.5,
          blended_score: 0.5,
          pinned: 0,
          promoted: 1,
          archived: 0,
        },
      ],
      relevancePick: null,
    };

    vi.mocked(api.getHomeReports).mockResolvedValue(mockReports as any);

    const { reportsStore } = await import('@/stores/reports');
    await reportsStore.loadHome();

    expect(reportsStore.top3).toHaveLength(1);
    expect(reportsStore.top3[0].title).toBe('Test');
  });

  it('should handle errors when loading', async () => {
    vi.mocked(api.getHomeReports).mockRejectedValue(new Error('Network error'));

    const { reportsStore } = await import('@/stores/reports');
    await reportsStore.loadHome();

    expect(reportsStore.error).toBe('Network error');
    expect(reportsStore.isLoading).toBe(false);
  });

  it('should pin a report', async () => {
    const mockReports = {
      top3: [{ id: 'r1', pinned: 0 }],
      relevancePick: null,
    };

    vi.mocked(api.getHomeReports).mockResolvedValue(mockReports as any);
    vi.mocked(api.pinReport).mockResolvedValue(undefined);

    const { reportsStore } = await import('@/stores/reports');
    await reportsStore.loadHome();
    await reportsStore.pinReport('r1');

    expect(api.pinReport).toHaveBeenCalledWith('r1');
    expect(reportsStore.top3[0].pinned).toBe(1);
  });

  it('should unpin a report', async () => {
    const mockReports = {
      top3: [{ id: 'r1', pinned: 1 }],
      relevancePick: null,
    };

    vi.mocked(api.getHomeReports).mockResolvedValue(mockReports as any);
    vi.mocked(api.unpinReport).mockResolvedValue(undefined);

    const { reportsStore } = await import('@/stores/reports');
    await reportsStore.loadHome();
    await reportsStore.unpinReport('r1');

    expect(api.unpinReport).toHaveBeenCalledWith('r1');
    expect(reportsStore.top3[0].pinned).toBe(0);
  });

  it('should load UI actions', async () => {
    const mockActions = {
      actions: [
        { action: 'useful', enabled: 1, shown_count: 10, clicked_count: 5, success_rate: 0.5 },
        { action: 'not_useful', enabled: 1, shown_count: 10, clicked_count: 2, success_rate: 0.2 },
      ],
    };

    vi.mocked(api.getUiActions).mockResolvedValue(mockActions);

    const { reportsStore } = await import('@/stores/reports');
    await reportsStore.loadUiActions();

    expect(reportsStore.uiActions).toHaveLength(2);
    expect(reportsStore.uiActions[0].action).toBe('useful');
  });

  it('should send feedback', async () => {
    vi.mocked(api.sendFeedback).mockResolvedValue(undefined);

    const { reportsStore } = await import('@/stores/reports');
    await reportsStore.sendFeedback('r1', 'useful');

    expect(api.sendFeedback).toHaveBeenCalledWith({
      report_id: 'r1',
      action: 'useful',
    });
  });

  it('should update filters', async () => {
    const { reportsStore } = await import('@/stores/reports');

    reportsStore.setFilter('sort', 'newest');
    expect(reportsStore.filter.sort).toBe('newest');

    reportsStore.setFilter('type', 'decision_memo');
    expect(reportsStore.filter.type).toBe('decision_memo');
  });
});

describe('TelemetryStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should track open events', async () => {
    vi.mocked(api.sendTelemetry).mockResolvedValue(undefined);

    const { telemetryStore } = await import('@/stores/telemetry');
    telemetryStore.trackOpen('r1');

    // Flush should send the event
    vi.advanceTimersByTime(5000);

    expect(api.sendTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        report_id: 'r1',
        event_type: 'open',
      })
    );
  });

  it('should track close events with dwell time', async () => {
    vi.mocked(api.sendTelemetry).mockResolvedValue(undefined);

    const { telemetryStore } = await import('@/stores/telemetry');

    telemetryStore.trackOpen('r1');
    vi.advanceTimersByTime(3000);
    telemetryStore.trackClose('r1');

    // Close should flush immediately
    expect(api.sendTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        report_id: 'r1',
        event_type: 'close',
      })
    );
  });

  it('should track scroll events', async () => {
    vi.mocked(api.sendTelemetry).mockResolvedValue(undefined);

    const { telemetryStore } = await import('@/stores/telemetry');
    telemetryStore.trackScroll('r1', 0.5);

    vi.advanceTimersByTime(5000);

    expect(api.sendTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        report_id: 'r1',
        event_type: 'scroll',
        event_data_json: JSON.stringify({ depth: 0.5 }),
      })
    );
  });

  it('should track click events', async () => {
    vi.mocked(api.sendTelemetry).mockResolvedValue(undefined);

    const { telemetryStore } = await import('@/stores/telemetry');
    telemetryStore.trackClick('r1', 'https://example.com');

    vi.advanceTimersByTime(5000);

    expect(api.sendTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        report_id: 'r1',
        event_type: 'click',
        event_data_json: JSON.stringify({ target: 'https://example.com' }),
      })
    );
  });

  it('should track pin events immediately', async () => {
    vi.mocked(api.sendTelemetry).mockResolvedValue(undefined);

    const { telemetryStore } = await import('@/stores/telemetry');
    telemetryStore.trackPin('r1');

    // Pin should flush immediately
    expect(api.sendTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        report_id: 'r1',
        event_type: 'pin',
      })
    );
  });
});
