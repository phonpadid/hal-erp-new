import { defineStore } from 'pinia';
import { financialReportsApi } from '../api/financialReports';
import type { AccountLedger, BalanceSheet, IncomeStatement, TrialBalance } from '../api/financialReports';
import { messageOf } from '../utils/apiError';

interface FinancialReportsState {
  trialBalance: TrialBalance | null;
  incomeStatement: IncomeStatement | null;
  balanceSheet: BalanceSheet | null;
  ledger: AccountLedger | null;
  loading: boolean;
  error: string;
}

export const useFinancialReportsStore = defineStore('financialReports', {
  state: (): FinancialReportsState => ({
    trialBalance: null, incomeStatement: null, balanceSheet: null, ledger: null, loading: false, error: '',
  }),
  actions: {
    async load<T>(fn: () => Promise<T>, assign: (v: T) => void) {
      this.loading = true;
      this.error = '';
      try {
        assign(await fn());
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },
    loadTrialBalance(from?: string, to?: string) {
      return this.load(() => financialReportsApi.trialBalance(from, to), (v) => (this.trialBalance = v));
    },
    loadIncomeStatement(from?: string, to?: string) {
      return this.load(() => financialReportsApi.incomeStatement(from, to), (v) => (this.incomeStatement = v));
    },
    loadBalanceSheet(asOf?: string) {
      return this.load(() => financialReportsApi.balanceSheet(asOf), (v) => (this.balanceSheet = v));
    },
    loadLedger(accountId: string, from?: string, to?: string) {
      return this.load(() => financialReportsApi.accountLedger(accountId, from, to), (v) => (this.ledger = v));
    },
  },
});
