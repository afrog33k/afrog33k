import { api, TelemetryEvent } from '@/lib/api';

class TelemetryStore {
  private openTime: Map<string, number> = new Map();
  private dwellBuffer: TelemetryEvent[] = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      this.flushInterval = setInterval(() => this.flush(), 5000);
    }
  }

  trackOpen(reportId: string) {
    this.openTime.set(reportId, Date.now());
    this.queue({ report_id: reportId, event_type: 'open' });
  }

  trackClose(reportId: string) {
    const openedAt = this.openTime.get(reportId);
    const dwellMs = openedAt ? Date.now() - openedAt : 0;
    this.openTime.delete(reportId);

    this.queue({
      report_id: reportId,
      event_type: 'close',
      event_data_json: JSON.stringify({ dwell_ms: dwellMs }),
    });
  }

  trackScroll(reportId: string, depth: number) {
    this.queue({
      report_id: reportId,
      event_type: 'scroll',
      event_data_json: JSON.stringify({ depth }),
    });
  }

  trackClick(reportId: string, target: string) {
    this.queue({
      report_id: reportId,
      event_type: 'click',
      event_data_json: JSON.stringify({ target }),
    });
  }

  trackPin(reportId: string) {
    this.queue({ report_id: reportId, event_type: 'pin' });
  }

  private queue(event: TelemetryEvent) {
    this.dwellBuffer.push(event);

    // Flush immediately for important events
    if (event.event_type === 'pin' || event.event_type === 'close') {
      this.flush();
    }
  }

  private async flush() {
    if (this.dwellBuffer.length === 0) return;

    const events = [...this.dwellBuffer];
    this.dwellBuffer = [];

    try {
      for (const event of events) {
        await api.sendTelemetry(event);
      }
    } catch (err) {
      console.error('Failed to send telemetry:', err);
      // Re-queue failed events
      this.dwellBuffer.unshift(...events);
    }
  }

  cleanup() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    this.flush();
  }
}

export const telemetryStore = new TelemetryStore();
