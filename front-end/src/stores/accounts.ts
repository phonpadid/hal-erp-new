import { defineStore } from 'pinia';
import { accountsApi } from '../api/accounts';
import type { Account, SelectableAccount } from '../api/accounts';
import { messageOf } from '../utils/apiError';

interface AccountsState {
  accounts: Account[];
  total: number;
  page: number;
  limit: number;
  // Full account list for the parent-account <Select> — decoupled from the paged table so
  // the dropdown never truncates to the current page.
  parents: Account[];
  // Active, postable accounts for the budget-form GL picker — kept apart from the admin list.
  selectable: SelectableAccount[];
  loading: boolean;
  error: string;
}

export const useAccountsStore = defineStore('accounts', {
  state: (): AccountsState => ({
    accounts: [], total: 0, page: 1, limit: 20, parents: [], selectable: [], loading: false, error: '',
  }),
  actions: {
    // Server-side paging: honor the page + rows the table asks for (AppDataTable contract).
    async loadAccounts(page?: number, limit?: number, includeInactive = true) {
      this.loading = true;
      this.error = '';
      try {
        const res = await accountsApi.list(page ?? this.page, limit ?? this.limit, includeInactive);
        this.page = res.page;
        this.limit = res.limit;
        this.total = res.total;
        this.accounts = res.items;
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    // Full list (all types/flags) for the parent <Select>; parents are often non-postable
    // summary nodes, so this is broader than `selectable`. One large page is enough for a
    // realistic chart of accounts.
    async loadParents() {
      try {
        this.parents = (await accountsApi.list(1, 500, true)).items;
      } catch (e) {
        this.error = messageOf(e);
      }
    },

    async loadSelectable() {
      try {
        this.selectable = await accountsApi.selectable();
      } catch (e) {
        this.error = messageOf(e);
      }
    },

    async createAccount(dto: unknown): Promise<boolean> {
      this.error = '';
      try {
        await accountsApi.create(dto);
        await Promise.all([this.loadAccounts(), this.loadParents()]);
        return true;
      } catch (e) {
        this.error = messageOf(e);
        return false;
      }
    },

    async updateAccount(id: string, dto: unknown): Promise<boolean> {
      this.error = '';
      try {
        await accountsApi.update(id, dto);
        await Promise.all([this.loadAccounts(), this.loadParents()]);
        return true;
      } catch (e) {
        this.error = messageOf(e);
        return false;
      }
    },
  },
});
