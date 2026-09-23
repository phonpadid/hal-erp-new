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

// ---- Pending summary: the department's weekly view -------------------------------------------
// Every IN_APPROVAL document the reader may SEE (their DOC_VIEW scope, as the documents list), not
// only what they must sign — so a head reads where the department's documents wait, and on whom.

export interface PendingSummaryFilters {
  departmentId?: string;
  documentTypeId?: string;
  /** `YYYY-MM-DD` calendar days; `submittedTo` inclusive. The week the department reports on. */
  submittedFrom?: string;
  submittedTo?: string;
  overdueOnly?: boolean;
}

/** Per-currency sums as decimal strings, keyed by currency code. Never a JS number. */
export type AmountsByCurrency = Record<string, string>;

export interface PendingSummaryRow {
  documentId: string;
  docNo: string;
  documentType: { id: string; code: string; name: string };
  department: { id: string; deptCode: string; name: string };
  requesterName: string;
  submittedAt: string | null;
  waitingDays: number | null;
  currentStepNo: number;
  stepName: string | null;
  waitingOn: Array<{ userId: string; name: string }>;
  currencyCode: string;
  grandTotal: string;
  slaDueAt: string | null;
  overdue: boolean;
}

export interface PendingSummary {
  rows: PendingSummaryRow[];
  facets: {
    departments: Array<{ id: string; deptCode: string; name: string; count: number }>;
    documentTypes: Array<{ id: string; code: string; name: string; count: number }>;
  };
  byDepartment: Array<{ id: string; deptCode: string; name: string; pendingCount: number; oldestWaitingDays: number | null; totals: AmountsByCurrency }>;
  byStep: Array<{ stepNo: number; stepName: string | null; pendingCount: number; oldestWaitingDays: number | null }>;
  byApprover: Array<{ userId: string; name: string; pendingCount: number; oldestWaitingDays: number | null }>;
  totals: { pendingCount: number; overdueCount: number; amounts: AmountsByCurrency };
  meta: {
    companyCode: string;
    companyName: string;
    baseCurrency: string;
    today: string;
    departmentName: string | null;
    submittedFrom: string | null;
    submittedTo: string | null;
    decimalPlaces: Record<string, number>;
  };
}

/** Only the filters that are set travel; an unset toggle adds no parameter at all. */
function summaryParams(f: PendingSummaryFilters): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ['departmentId', 'documentTypeId', 'submittedFrom', 'submittedTo'] as const) {
    const v = f[k];
    if (v) out[k] = v;
  }
  if (f.overdueOnly) out.overdueOnly = 'true';
  return out;
}

/** The `filename="..."` of a Content-Disposition header, or undefined when there is none. */
function fileNameFrom(header: unknown): string | undefined {
  if (typeof header !== 'string') return undefined;
  return /filename="([^"]+)"/.exec(header)?.[1];
}

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
  /**
   * Which of these documents the caller may act on right now.
   *
   * The documents list asks before it draws an Approve button. Answered by the same server path as
   * `pending` — eligibility, delegation and the no-self-approval rule all resolved once, there —
   * so the list can never offer an action the inbox would refuse. Needs `DOC_APPROVE`.
   */
  actionable: (documentIds: string[]) =>
    api.post<string[]>('/approvals/actionable', { documentIds }).then((r) => r.data),
  act: (id: string, body: { action: ApprovalAction; remark?: string }) =>
    api.post(`/documents/${id}/actions`, body).then((r) => r.data),
  pendingSummary: (filters: PendingSummaryFilters = {}) =>
    api.get<PendingSummary>('/approvals/pending-summary', { params: summaryParams(filters) }).then((r) => r.data),
  // The same set as the screen, as one workbook; the file name comes from the server.
  exportPendingSummary: (filters: PendingSummaryFilters = {}) =>
    api
      .get('/approvals/pending-summary.xlsx', { params: summaryParams(filters), responseType: 'blob' })
      .then((r) => ({
        blob: r.data as Blob,
        fileName: fileNameFrom(r.headers?.['content-disposition']) ?? 'pending-approvals.xlsx',
      })),
};
