import { defineStore } from 'pinia';
import { approvalsApi } from '../api/approvals';
import type { ApprovalAction, PendingApproval } from '../api/approvals';
import { messageOf } from '../utils/apiError';

interface ApprovalsState {
  pending: PendingApproval[];
  total: number;
  page: number;
  limit: number;
  loading: boolean;
  error: string;
  /** The term the server is filtering the pending set by. Kept so paging preserves it. */
  search: string;
}


export const useApprovalsStore = defineStore('approvals', {
  state: (): ApprovalsState => ({ pending: [], total: 0, page: 1, limit: 20, loading: false, error: '', search: '' }),
  actions: {
    /**
     * `search` is sent to the server, which filters the whole pending set before paging it.
     * Passing it explicitly (rather than reading `this.search` only) lets a new term reset to
     * page 1 in the same call the term arrives in.
     */
    async loadPending(page?: number, limit?: number, search?: string) {
      this.loading = true;
      this.error = '';
      if (search !== undefined) this.search = search;
      try {
        const res = await approvalsApi.pending(page ?? this.page, limit ?? this.limit, this.search || undefined);
        this.pending = res.items;
        this.total = res.total;
        this.page = res.page;
        this.limit = res.limit;
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    /** Act on a document, then refresh the inbox. The open document (if any) is refreshed by
     *  its own view via loadDetail — acting here previously did a partial loadOne that the
     *  view's loadDetail immediately threw away, so that redundant fetch is dropped. */
    async act(id: string, action: ApprovalAction, remark?: string): Promise<boolean> {
      this.error = '';
      try {
        await approvalsApi.act(id, { action, remark });
        await this.loadPending();
        return true;
      } catch (e) {
        this.error = messageOf(e);
        return false;
      }
    },
  },
});
