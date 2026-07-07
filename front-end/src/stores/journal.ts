import { defineStore } from 'pinia';
import { journalApi } from '../api/journal';
import type { JournalEntry } from '../api/journal';
import { messageOf } from '../utils/apiError';

interface JournalState {
  entries: JournalEntry[];
  total: number;
  page: number;
  limit: number;
  loading: boolean;
  error: string;
}

export const useJournalStore = defineStore('journal', {
  state: (): JournalState => ({ entries: [], total: 0, page: 1, limit: 20, loading: false, error: '' }),
  actions: {
    async loadEntries(page?: number, limit?: number) {
      this.loading = true;
      this.error = '';
      try {
        const res = await journalApi.list(page ?? this.page, limit ?? this.limit);
        this.page = res.page;
        this.limit = res.limit;
        this.total = res.total;
        this.entries = res.items;
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },
  },
});
