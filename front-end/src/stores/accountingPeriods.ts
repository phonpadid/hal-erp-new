import { defineStore } from 'pinia';
import {
  accountingPeriodsApi,
  type AccountingPeriodRow,
  type DeclarePeriodInput,
  type PeriodLogEntry,
  type SelectableFiscalYear,
} from '../api/accountingPeriods';
import { messageOf } from '../utils/apiError';

interface AccountingPeriodsState {
  periods: AccountingPeriodRow[];
  fiscalYears: SelectableFiscalYear[];
  /**
   * The log of the period whose history is open — one at a time, not a map keyed by period. A cache
   * would have to be invalidated on every close and reopen, for a screen showing twelve rows.
   */
  log: PeriodLogEntry[];
  logPeriodId: string;
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
    fiscalYears: [],
    log: [],
    logPeriodId: '',
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

    async loadFiscalYears() {
      this.error = '';
      try {
        this.fiscalYears = await accountingPeriodsApi.selectableFiscalYears();
      } catch (e) {
        this.error = messageOf(e);
      }
    },

    /** Fetched when a history panel opens — see the note on `log` above. */
    async loadLog(periodId: string) {
      this.error = '';
      this.logPeriodId = periodId;
      this.log = [];
      try {
        this.log = await accountingPeriodsApi.log(periodId);
      } catch (e) {
        this.error = messageOf(e);
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
