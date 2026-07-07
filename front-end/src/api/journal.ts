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

export const journalApi = {
  list: (page = 1, limit = 20) =>
    api.get<Paginated<JournalEntry>>('/journal', { params: { page, limit } }).then((r) => r.data),
};
