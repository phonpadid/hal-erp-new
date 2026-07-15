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
}


export const useApprovalsStore = defineStore('approvals', {
  state: (): ApprovalsState => ({ pending: [], total: 0, page: 1, limit: 20, loading: false, error: '' }),
  actions: {
    async loadPending(page?: number, limit?: number) {
      this.loading = true;
      this.error = '';
      try {
        const res = await approvalsApi.pending(page ?? this.page, limit ?? this.limit);
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
