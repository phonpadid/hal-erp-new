import { api } from './client';
import type { Paginated } from './pagination';

export interface PendingApproval {
  id: string;
  docNo: string;
  documentType: { code: string; name: string };
  requesterName: string;
  baseTotalAmount: string | null;
  currentStepNo: number | null;
  submittedAt: string | null;
  slaDueAt: string | null;
  overdue: boolean;
}

export type ApprovalAction = 'APPROVE' | 'REJECT' | 'RETURN';

/** Approver inbox + acting on a document (the act endpoint lives under documents/:id). */
export const approvalsApi = {
  // `search` is answered by the server across the whole pending set, not by filtering the page
  // the client happens to hold — the inbox pages, so a client-side filter would search a fraction
  // of the queue and look like it had searched all of it.
  pending: (page = 1, limit = 20, search?: string) =>
    api
      .get<Paginated<PendingApproval>>('/approvals/pending', {
        params: { page, limit, ...(search ? { search } : {}) },
      })
      .then((r) => r.data),
  act: (id: string, body: { action: ApprovalAction; remark?: string }) =>
    api.post(`/documents/${id}/actions`, body).then((r) => r.data),
};
