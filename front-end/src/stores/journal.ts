import { defineStore } from 'pinia';
import { journalApi } from '../api/journal';
import type {
  JournalEntry,
  JournalVoucherInput,
  OpenPayable,
  PayablesAgeing,
  ReverseEntryInput,
  UndeliveredPosting,
} from '../api/journal';
import { messageOf } from '../utils/apiError';

interface JournalState {
  entries: JournalEntry[];
  total: number;
  page: number;
  limit: number;
  undelivered: UndeliveredPosting[];
  undeliveredTotal: number;
  undeliveredPage: number;
  undeliveredLimit: number;
  /** Unpaginated: the endpoint returns every open payable in one response. */
  payables: OpenPayable[];
  /** The bands, from the server — the client never computes one. */
  ageing: PayablesAgeing | null;
  loading: boolean;
  working: boolean;
  error: string;
}

export const useJournalStore = defineStore('journal', {
  state: (): JournalState => ({
    entries: [], total: 0, page: 1, limit: 20,
    undelivered: [], undeliveredTotal: 0, undeliveredPage: 1, undeliveredLimit: 20,
    payables: [],
    ageing: null,
    loading: false, working: false, error: '',
  }),
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

    /**
     * Writes return a boolean and leave the server's message in `error` unaltered — a refusal here
     * names the account it could not resolve, or the entry a reversal already exists for, and
     * rewriting that on the client would mean re-deriving the rule that produced it.
     */
    async write(fn: () => Promise<unknown>, reload?: () => Promise<void>): Promise<boolean> {
      this.working = true;
      this.error = '';
      try {
        await fn();
        await reload?.();
        return true;
      } catch (e) {
        this.error = messageOf(e);
        return false;
      } finally {
        this.working = false;
      }
    },

    /**
     * Posting does NOT reload: the voucher form is its own route and navigates away on success, so
     * refetching a list nobody is looking at is work for its own sake.
     */
    postVoucher(dto: JournalVoucherInput) {
      return this.write(() => journalApi.postVoucher(dto));
    },

    /** Reversing DOES reload — it happens on the journal, where the new entry belongs in the list. */
    reverse(id: string, dto: ReverseEntryInput = {}) {
      return this.write(() => journalApi.reverse(id, dto), () => this.loadEntries());
    },

    async loadUndelivered(page?: number, limit?: number) {
      this.loading = true;
      this.error = '';
      try {
        const res = await journalApi.undelivered(page ?? this.undeliveredPage, limit ?? this.undeliveredLimit);
        this.undeliveredPage = res.page;
        this.undeliveredLimit = res.limit;
        this.undeliveredTotal = res.total;
        this.undelivered = res.items;
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    async loadPayables() {
      this.loading = true;
      this.error = '';
      try {
        const [list, ageing] = await Promise.all([
          journalApi.openPayables(),
          journalApi.payablesAgeing(),
        ]);
        this.payables = list.items;
        this.ageing = ageing;
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    /** A re-queued posting changes status, so the list it came from is refetched. */
    requeue(id: string) {
      return this.write(() => journalApi.requeue(id), () => this.loadUndelivered());
    },
  },
});
