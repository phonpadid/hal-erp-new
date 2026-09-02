import { defineStore } from 'pinia';
import {
  bankAccountsApi,
  type BankAccountRow,
  type BankReconciliation,
  type OutstandingPayment,
} from '../api/bankAccounts';
import { messageOf } from '../utils/apiError';

interface BankAccountsState {
  accounts: BankAccountRow[];
  reconciliation: BankReconciliation | null;
  unattributed: { items: OutstandingPayment[]; total: string };
  loading: boolean;
  working: boolean;
  error: string;
}

/** The company's bank accounts, and what the bank has not yet confirmed. */
export const useBankAccountsStore = defineStore('bankAccounts', {
  state: (): BankAccountsState => ({
    accounts: [],
    reconciliation: null,
    unattributed: { items: [], total: '0' },
    loading: false,
    working: false,
    error: '',
  }),
  actions: {
    async load() {
      this.loading = true;
      this.error = '';
      try {
        const [accounts, unattributed] = await Promise.all([
          bankAccountsApi.list(),
          bankAccountsApi.unattributed(),
        ]);
        this.accounts = accounts;
        this.unattributed = unattributed;
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    async loadReconciliation(bankAccountId: string) {
      this.error = '';
      this.reconciliation = null;
      try {
        this.reconciliation = await bankAccountsApi.outstanding(bankAccountId);
      } catch (e) {
        this.error = messageOf(e);
      }
    },

    async create(dto: {
      name: string; bankName: string; accountNo: string; currencyCode: string; glAccountId: string;
    }): Promise<boolean> {
      this.working = true;
      this.error = '';
      try {
        await bankAccountsApi.create(dto);
        await this.load();
        return true;
      } catch (e) {
        this.error = messageOf(e);
        return false;
      } finally {
        this.working = false;
      }
    },

    /** Deactivated, not deleted: payments point at it. */
    async deactivate(id: string): Promise<boolean> {
      this.working = true;
      this.error = '';
      try {
        await bankAccountsApi.deactivate(id);
        await this.load();
        return true;
      } catch (e) {
        this.error = messageOf(e);
        return false;
      } finally {
        this.working = false;
      }
    },

    /** Returns a boolean and leaves the server's refusal in `error`, unaltered. */
    async confirmCleared(paymentId: string, clearedOn: string, bankAccountId: string): Promise<boolean> {
      this.working = true;
      this.error = '';
      try {
        await bankAccountsApi.confirmCleared(paymentId, clearedOn);
        await this.loadReconciliation(bankAccountId);
        return true;
      } catch (e) {
        this.error = messageOf(e);
        return false;
      } finally {
        this.working = false;
      }
    },
  },
});
