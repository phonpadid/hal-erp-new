import { defineStore } from 'pinia';
import type { BudgetCreateInput, BudgetTransferInput, BudgetUpdateInput } from '@erp/shared';
import { budgetsApi } from '../api/budgets';
import type { BalanceBreakdown, BudgetSummary, LedgerEntry } from '../api/budgets';
import { messageOf } from '../utils/apiError';

interface BudgetsState {
  list: Array<BudgetSummary & { available?: string }>;
  total: number;
  page: number;
  limit: number;
  current: any | null;
  breakdown: BalanceBreakdown | null;
  ledger: LedgerEntry[];
  ledgerTotal: number;
  ledgerPage: number;
  ledgerLimit: number;
  ledgerLoading: boolean;
  loading: boolean;
  error: string;
}


export const useBudgetsStore = defineStore('budgets', {
  state: (): BudgetsState => ({ list: [], total: 0, page: 1, limit: 20, current: null, breakdown: null, ledger: [], ledgerTotal: 0, ledgerPage: 1, ledgerLimit: 20, ledgerLoading: false, loading: false, error: '' }),
  actions: {
    async loadList(page?: number, limit?: number) {
      this.loading = true;
      this.error = '';
      try {
        const res = await budgetsApi.list(page ?? this.page, limit ?? this.limit);
        this.page = res.page;
        this.limit = res.limit;
        this.total = res.total;
        // Available per row from the derived breakdown (demo scale; see design note).
        this.list = await Promise.all(
          res.items.map(async (b) => ({ ...b, available: (await budgetsApi.breakdown(b.id)).available })),
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
      try {
        this.current = await budgetsApi.get(id);
        this.breakdown = await budgetsApi.breakdown(id);
        await this.loadLedger(id, 1);
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    // Paged, newest-first ledger. Called for page 1 by loadOne; the detail view
    // re-invokes it on paginator page changes (server-side paging).
    async loadLedger(id: string, page?: number, limit?: number) {
      this.ledgerLoading = true;
      try {
        const res = await budgetsApi.ledger(id, page ?? this.ledgerPage, limit ?? this.ledgerLimit);
        this.ledger = res.items;
        this.ledgerTotal = res.total;
        this.ledgerPage = res.page;
        this.ledgerLimit = res.limit;
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.ledgerLoading = false;
      }
    },

    // BUDGET_MANAGE affordances. These rethrow so the caller can route on success and
    // surface server errors; this.error mirrors the message for inline display.
    async createBudget(input: BudgetCreateInput): Promise<BudgetSummary> {
      this.error = '';
      try {
        return await budgetsApi.create(input);
      } catch (e) {
        this.error = messageOf(e);
        throw e;
      }
    },

    async updateBudget(id: string, input: BudgetUpdateInput): Promise<BudgetSummary> {
      this.error = '';
      try {
        return await budgetsApi.update(id, input);
      } catch (e) {
        this.error = messageOf(e);
        throw e;
      }
    },

    // Creates the approvable transfer document; returns its id so the caller can route
    // to it. Balances do not change until that document is fully approved.
    async createTransfer(input: BudgetTransferInput): Promise<{ documentId: string }> {
      this.error = '';
      try {
        return await budgetsApi.createTransfer(input);
      } catch (e) {
        this.error = messageOf(e);
        throw e;
      }
    },
  },
});
