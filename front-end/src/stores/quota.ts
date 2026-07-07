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
  loading: boolean;
  error: string;
}


export const useQuotaStore = defineStore('quota', {
  state: (): QuotaState => ({
    list: [], total: 0, page: 1, limit: 20,
    current: null, breakdown: null,
    usage: [], usageTotal: 0, usagePage: 1, usageLimit: 20, currentId: '',
    loading: false, error: '',
  }),
  actions: {
    async loadList(page?: number, limit?: number) {
      this.loading = true;
      this.error = '';
      try {
        const res = await quotasApi.list(page ?? this.page, limit ?? this.limit);
        this.total = res.total;
        this.page = res.page;
        this.limit = res.limit;
        // Pool remaining per row from the derived breakdown (demo scale; see design note).
        this.list = await Promise.all(
          res.items.map(async (q) => ({ ...q, remaining: (await quotasApi.breakdown(q.id)).pool.remaining })),
        );
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
        this.current = await quotasApi.get(id);
        this.breakdown = await quotasApi.breakdown(id);
        const usage = await quotasApi.usage(id, this.usagePage, this.usageLimit);
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
