import { api } from './client';
import type { Paginated } from './pagination';

export interface JournalLine {
  id: string;
  account?: { code?: string; name?: string } | null;
  debit: string;
  credit: string;
  memo?: string | null;
}

export interface JournalEntry {
  id: string;
  entryDate: string;
  sourceType: string;
  sourceId: string;
  sourceDocNo?: string | null;
  memo?: string | null;
  lines: JournalLine[];
}

export interface JournalVoucherLineInput {
  accountCode: string;
  /** Decimal strings. Money never crosses the wire as a JS number. */
  debit: string;
  credit: string;
  memo?: string;
}

export interface JournalVoucherInput {
  /**
   * The voucher's identity. Supplying one makes the request idempotent: a retry resolves to the
   * same entry instead of posting the ledger twice. Minted by the caller, not here — the view owns
   * when a new voucher begins.
   */
  id: string;
  entryDate: string;
  memo: string;
  lines: JournalVoucherLineInput[];
}

/**
 * A posting the ledger owes and has not delivered.
 *
 * `status` is PENDING or FAILED and nothing else — those are the two the endpoint returns, and they
 * are the two states in which an entry is still owed. POSTED and SKIPPED are answers.
 */
export interface UndeliveredPosting {
  id: string;
  sourceType: string;
  sourceId: string;
  sourceDocNo?: string | null;
  status: 'PENDING' | 'FAILED';
  attempts: number;
  lastError?: string | null;
  lastAttemptAt?: string | null;
  createdAt?: string | null;
}

export type AgeingBucket = 'NOT_DUE' | 'D1_30' | 'D31_60' | 'D61_90' | 'D90_PLUS';

/** A vendor accrual with no payment against it. Derived from the journal, so it cannot drift. */
export interface OpenPayable {
  documentId: string;
  documentNo: string | null;
  vendorId: string | null;
  vendorName: string | null;
  /** Decimal string. */
  amount: string;
  invoiceDate: string;
  dueDate: string;
  /**
   * Both computed on the SERVER, against the company's calendar day. The browser's today is not the
   * company's, so a bucket derived here would classify the same payable differently for viewers in
   * different timezones.
   */
  daysOverdue: number;
  bucket: AgeingBucket;
}

export interface PayablesAgeing {
  agedAt: string;
  buckets: Array<{ bucket: AgeingBucket; total: string; count: number }>;
  total: string;
}

export type VoucherStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';

/** A voucher awaiting a second pair of eyes. Nothing is in the ledger until it is approved. */
export interface PendingVoucher {
  id: string;
  entryDate: string;
  memo: string;
  status: VoucherStatus;
  reversesEntryId?: string | null;
  createdBy: { id: string; username: string };
  lines: Array<{
    id: string;
    account?: { code?: string; name?: string } | null;
    debit: string;
    credit: string;
  }>;
}

export interface ReverseEntryInput {
  /** Omitted means today, deliberately not the original entry's date. */
  entryDate?: string;
  memo?: string;
}

export const journalApi = {
  list: (page = 1, limit = 20) =>
    api.get<Paginated<JournalEntry>>('/journal', { params: { page, limit } }).then((r) => r.data),
  /** SUBMITS for approval. Nothing reaches the ledger until somebody else approves it. */
  submitVoucher: (dto: JournalVoucherInput) =>
    api.post<PendingVoucher>('/journal/vouchers', dto).then((r) => r.data),
  pendingVouchers: () =>
    api.get<PendingVoucher[]>('/journal/vouchers/pending').then((r) => r.data),
  approveVoucher: (id: string) =>
    api.post<JournalEntry>(`/journal/vouchers/${id}/approve`, {}).then((r) => r.data),
  rejectVoucher: (id: string, reason: string) =>
    api.post<PendingVoucher>(`/journal/vouchers/${id}/reject`, { reason }).then((r) => r.data),
  withdrawVoucher: (id: string) =>
    api.post<PendingVoucher>(`/journal/vouchers/${id}/withdraw`, {}).then((r) => r.data),
  /** SUBMITS a reversal for approval — a reversal is a voucher whose lines were computed for you. */
  reverse: (id: string, dto: ReverseEntryInput = {}) =>
    api.post<PendingVoucher>(`/journal/${id}/reverse`, dto).then((r) => r.data),
  undelivered: (page = 1, limit = 20) =>
    api
      .get<Paginated<UndeliveredPosting>>('/journal/undelivered', { params: { page, limit } })
      .then((r) => r.data),
  /**
   * No paging arguments: the endpoint accepts them and ignores them, returning every row in one
   * response. Passing them would imply a contract that is not there.
   */
  openPayables: () =>
    api.get<Paginated<OpenPayable>>('/journal/open-payables').then((r) => r.data),
  /** The bands and their totals, derived server-side from the same rows and the same company day. */
  payablesAgeing: () =>
    api.get<PayablesAgeing>('/journal/open-payables/ageing').then((r) => r.data),
  /** Only a FAILED posting can be re-queued; the server refuses any other status. */
  requeue: (id: string) =>
    api.post<UndeliveredPosting>(`/journal/undelivered/${id}/requeue`, {}).then((r) => r.data),
};
