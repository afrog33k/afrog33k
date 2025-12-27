import { makeAutoObservable, runInAction } from 'mobx';
import { api, Report, UiAction, SystemStats } from '@/lib/api';

class ReportsStore {
  top3: Report[] = [];
  relevancePick: Report | null = null;
  allReports: Report[] = [];
  totalReports = 0;
  selectedReport: Report | null = null;

  uiActions: UiAction[] = [];
  stats: SystemStats | null = null;

  isLoading = false;
  error: string | null = null;

  // Filters for All Cards view
  filter = {
    sort: 'blended_score' as string,
    type: '' as string,
    pinned: '' as string,
  };

  constructor() {
    makeAutoObservable(this);
  }

  async loadHome() {
    this.isLoading = true;
    this.error = null;

    try {
      const data = await api.getHomeReports();
      runInAction(() => {
        this.top3 = data.top3;
        this.relevancePick = data.relevancePick;
        this.isLoading = false;
      });
    } catch (err: any) {
      runInAction(() => {
        this.error = err.message;
        this.isLoading = false;
      });
    }
  }

  async loadAllReports() {
    this.isLoading = true;
    this.error = null;

    try {
      const params: Record<string, string> = { sort: this.filter.sort };
      if (this.filter.type) params.type = this.filter.type;
      if (this.filter.pinned) params.pinned = this.filter.pinned;

      const data = await api.getReports(params);
      runInAction(() => {
        this.allReports = data.reports;
        this.totalReports = data.total;
        this.isLoading = false;
      });
    } catch (err: any) {
      runInAction(() => {
        this.error = err.message;
        this.isLoading = false;
      });
    }
  }

  async loadReport(id: string) {
    this.isLoading = true;

    try {
      const report = await api.getReport(id);
      runInAction(() => {
        this.selectedReport = report;
        this.isLoading = false;
      });
    } catch (err: any) {
      runInAction(() => {
        this.error = err.message;
        this.isLoading = false;
      });
    }
  }

  async pinReport(id: string) {
    try {
      await api.pinReport(id);
      runInAction(() => {
        const updatePin = (r: Report) => (r.id === id ? { ...r, pinned: 1 } : r);
        this.top3 = this.top3.map(updatePin);
        this.allReports = this.allReports.map(updatePin);
        if (this.relevancePick?.id === id) {
          this.relevancePick = { ...this.relevancePick, pinned: 1 };
        }
        if (this.selectedReport?.id === id) {
          this.selectedReport = { ...this.selectedReport, pinned: 1 };
        }
      });
    } catch (err: any) {
      this.error = err.message;
    }
  }

  async unpinReport(id: string) {
    try {
      await api.unpinReport(id);
      runInAction(() => {
        const updatePin = (r: Report) => (r.id === id ? { ...r, pinned: 0 } : r);
        this.top3 = this.top3.map(updatePin);
        this.allReports = this.allReports.map(updatePin);
        if (this.relevancePick?.id === id) {
          this.relevancePick = { ...this.relevancePick, pinned: 0 };
        }
        if (this.selectedReport?.id === id) {
          this.selectedReport = { ...this.selectedReport, pinned: 0 };
        }
      });
    } catch (err: any) {
      this.error = err.message;
    }
  }

  async loadUiActions() {
    try {
      const data = await api.getUiActions();
      runInAction(() => {
        this.uiActions = data.actions;
      });
    } catch (err: any) {
      console.error('Failed to load UI actions:', err);
    }
  }

  async loadStats() {
    try {
      const stats = await api.getStats();
      runInAction(() => {
        this.stats = stats;
      });
    } catch (err: any) {
      console.error('Failed to load stats:', err);
    }
  }

  async sendFeedback(reportId: string, action: string) {
    try {
      await api.sendFeedback({ report_id: reportId, action });
    } catch (err: any) {
      console.error('Failed to send feedback:', err);
    }
  }

  setFilter(key: keyof typeof this.filter, value: string) {
    this.filter[key] = value;
  }
}

export const reportsStore = new ReportsStore();
