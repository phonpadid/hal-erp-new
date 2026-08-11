import { defineStore } from 'pinia';
import { accountingPeriodsApi, type AccountingPeriodRow, type DeclarePeriodInput } from '../api/accountingPeriods';
import { messageOf } from '../utils/apiError';

interface AccountingPeriodsState {
  periods: AccountingPeriodRow[];
  loading: boolean;
  working: boolean;
  error: string;
}

/**
 * The month-end close.
 *
 * Every write returns a boolean rather than throwing, so the view can tell a refusal from a success
 * without reading the error string — and `error` carries the server's message unaltered. A refused
 * close names the period that blocks it or the postings still owed; rewriting that text on the
 * client would mean re-deriving the rule that produced it.
 */
export const useAccountingPeriodsStore = defineStore('accountingPeriods', {
  state: (): AccountingPeriodsState => ({
    periods: [],
    loading: false,
    working: false,
    error: '',
  }),
  actions: {
    async load() {
      this.loading = true;
      this.error = '';
      try {
        this.periods = await accountingPeriodsApi.list();
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    /** Wraps a write: reload on success, leave the list untouched and keep the message on failure. */
    async run(fn: () => Promise<unknown>): Promise<boolean> {
      this.working = true;
      this.error = '';
      try {
        await fn();
        await this.load();
        return true;
      } catch (e) {
        this.error = messageOf(e);
        return false;
      } finally {
        this.working = false;
      }
    },

    declare(dto: DeclarePeriodInput) {
      return this.run(() => accountingPeriodsApi.declare(dto));
    },
    close(id: string) {
      return this.run(() => accountingPeriodsApi.close(id));
    },
    reopen(id: string, reason: string) {
      return this.run(() => accountingPeriodsApi.reopen(id, reason));
    },
  },
});
