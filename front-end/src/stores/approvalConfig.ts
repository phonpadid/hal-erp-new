import { defineStore } from 'pinia';
import { approvalConfigApi } from '../api/approvalConfig';
import type { Delegation } from '../api/approvalConfig';
import { messageOf } from '../utils/apiError';

interface ApprovalConfigState {
  delegations: Delegation[];
  // Paged state for the delegations table.
  total: number;
  page: number;
  limit: number;
  // Select-option sources; loaded at the max page so dropdowns aren't truncated.
  users: Array<{ id: string; username: string }>;
  documentTypes: Array<{ id: string; code: string }>;
  loading: boolean;
  error: string;
}


export const useApprovalConfigStore = defineStore('approvalConfig', {
  state: (): ApprovalConfigState => ({
    delegations: [],
    total: 0,
    page: 1,
    limit: 20,
    users: [],
    documentTypes: [],
    loading: false,
    error: '',
  }),
  actions: {
    async loadDelegations(page?: number, limit?: number) {
      this.loading = true;
      this.error = '';
      try {
        const res = await approvalConfigApi.delegations.list(page ?? this.page, limit ?? this.limit);
        this.delegations = res.items;
        this.total = res.total;
        this.page = res.page;
        this.limit = res.limit;
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    async loadAll() {
      this.loading = true;
      this.error = '';
      try {
        // users feeds the delegator/delegate Selects, so it loads at limit=100 (api default).
        const [delegations, users, documentTypes] = await Promise.all([
          approvalConfigApi.delegations.list(this.page, this.limit),
          approvalConfigApi.users().catch(() => []),
          approvalConfigApi.documentTypes().catch(() => []),
        ]);
        this.delegations = delegations.items;
        this.total = delegations.total;
        this.page = delegations.page;
        this.limit = delegations.limit;
        this.users = users;
        this.documentTypes = documentTypes;
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    async run(fn: () => Promise<unknown>): Promise<boolean> {
      this.error = '';
      try {
        await fn();
        await this.loadAll();
        return true;
      } catch (e) {
        this.error = messageOf(e);
        return false;
      }
    },

    createDelegation(dto: unknown) { return this.run(() => approvalConfigApi.delegations.create(dto)); },
    cancelDelegation(id: string) { return this.run(() => approvalConfigApi.delegations.cancel(id)); },
  },
});
