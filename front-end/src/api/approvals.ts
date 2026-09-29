import { api } from './client';
import type { Paginated } from './pagination';
import type { IntakeState } from './documents';

export interface PendingApproval {
  id: string;
  docNo: string;
  documentType: { code: string; name: string };
  /** The employee's full name, else the login — resolved by the server as the documents list is. */
  requesterName: string;
  requesterDepartment: string | null;
  baseTotalAmount: string | null;
  currentStepNo: number | null;
  submittedAt: string | null;
  slaDueAt: string | null;
  overdue: boolean;
  /** Finance's intake state; `canReceive` is the server's verdict for THIS reader. */
  intake: IntakeState;
}

/**
 * The inbox's three filters. Every inbox row is pending by definition, so there is no status; the
 * amounts stay the strings typed and never become a JS number.
 */
export interface PendingInboxFilters {
  departmentId?: string;
  /** `YYYY-MM-DD` calendar days on the submitted date; `submittedTo` inclusive. */
  submittedFrom?: string;
  submittedTo?: string;
  minAmount?: string;
  maxAmount?: string;
  /** Finance's intake: only documents received at their desk, or only those not yet. */
  intake?: 'RECEIVED' | 'NOT_RECEIVED';
}

/** Only the filters that are set travel, together with the search when there is one. */
function inboxParams(f: PendingInboxFilters, search?: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ['departmentId', 'submittedFrom', 'submittedTo', 'minAmount', 'maxAmount', 'intake'] as const) {
    const v = f[k];
    if (v) out[k] = v;
  }
  if (search) out.search = search;
  return out;
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
  pending: (page = 1, limit = 20, search?: string, filters: PendingInboxFilters = {}) =>
    api
      .get<Paginated<PendingApproval>>('/approvals/pending', {
        params: { page, limit, ...inboxParams(filters, search) },
      })
      .then((r) => r.data),
  /**
   * The payables sheet of the WHOLE filtered inbox — every page, not the one shown. The same sheet
   * as the documents list's export, holding only what waits on this reader.
   */
  exportPending: (filters: PendingInboxFilters = {}, search?: string) =>
    api
      .get('/approvals/pending/payables.xlsx', { params: inboxParams(filters, search), responseType: 'blob' })
      .then((r) => ({
        blob: r.data as Blob,
        fileName: fileNameFrom(r.headers?.['content-disposition']) ?? 'pending-approvals-payables.xlsx',
      })),
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
