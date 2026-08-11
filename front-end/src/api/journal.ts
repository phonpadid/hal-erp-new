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

export interface ReverseEntryInput {
  /** Omitted means today, deliberately not the original entry's date. */
  entryDate?: string;
  memo?: string;
}

export const journalApi = {
  list: (page = 1, limit = 20) =>
    api.get<Paginated<JournalEntry>>('/journal', { params: { page, limit } }).then((r) => r.data),
  postVoucher: (dto: JournalVoucherInput) =>
    api.post<JournalEntry>('/journal/vouchers', dto).then((r) => r.data),
  reverse: (id: string, dto: ReverseEntryInput = {}) =>
    api.post<JournalEntry>(`/journal/${id}/reverse`, dto).then((r) => r.data),
};
