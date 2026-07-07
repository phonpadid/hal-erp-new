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
  pending: (page = 1, limit = 20) =>
    api.get<Paginated<PendingApproval>>('/approvals/pending', { params: { page, limit } }).then((r) => r.data),
  act: (id: string, body: { action: ApprovalAction; remark?: string }) =>
    api.post(`/documents/${id}/actions`, body).then((r) => r.data),
};
