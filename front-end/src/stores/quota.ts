import { defineStore } from 'pinia';
import { quotasApi } from '../api/quotas';
import type { QuotaBreakdown, QuotaSummary, QuotaUsageEntry } from '../api/quotas';
import { messageOf } from '../utils/apiError';

interface QuotaState {
  list: Array<QuotaSummary & { remaining?: string }>;
  total: number;
  page: number;
  limit: number;
  current: any | null;
  breakdown: QuotaBreakdown | null;
  usage: QuotaUsageEntry[];
  usageTotal: number;
  usagePage: number;
  usageLimit: number;
  currentId: string;
  /**
   * The search term the server is answering, per list. Kept in the store rather than passed
   * per call so paging keeps it: page 2 of a search is page 2 of that same search.
   */
  search: string;
  loading: boolean;
  error: string;
}


export const useQuotaStore = defineStore('quota', {
  state: (): QuotaState => ({
    list: [], total: 0, page: 1, limit: 20,
    current: null, breakdown: null,
    usage: [], usageTotal: 0, usagePage: 1, usageLimit: 20, currentId: '',
    search: '',
    loading: false, error: '',
  }),
  actions: {
    async loadList(page?: number, limit?: number, search?: string) {
      this.loading = true;
      this.error = '';
      if (search !== undefined) this.search = search;
      try {
        const res = await quotasApi.list(page ?? this.page, limit ?? this.limit, this.search || undefined);
        this.total = res.total;
        this.page = res.page;
        this.limit = res.limit;
        // `remaining` is now computed server-side per row (one batched pass), so the list
        // renders without the old per-row breakdown fetch (N+1).
        this.list = res.items;
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    async loadOne(id: string) {
      this.loading = true;
      this.error = '';
      this.currentId = id;
      try {
        // Header, derived breakdown and the first usage page are independent — fetch together.
        const [current, breakdown, usage] = await Promise.all([
          quotasApi.get(id),
          quotasApi.breakdown(id),
          quotasApi.usage(id, this.usagePage, this.usageLimit),
        ]);
        this.current = current;
        this.breakdown = breakdown;
        this.usage = usage.items;
        this.usageTotal = usage.total;
        this.usagePage = usage.page;
        this.usageLimit = usage.limit;
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    async loadUsage(page?: number, limit?: number) {
      this.error = '';
      try {
        const usage = await quotasApi.usage(this.currentId, page ?? this.usagePage, limit ?? this.usageLimit);
        this.usage = usage.items;
        this.usageTotal = usage.total;
        this.usagePage = usage.page;
        this.usageLimit = usage.limit;
      } catch (e) {
        this.error = messageOf(e);
      }
    },
  },
});
