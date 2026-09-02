import { defineStore } from 'pinia';
import { journalApi } from '../api/journal';
import { approvalsApi } from '../api/approvals';
import type { ApprovalAction } from '../api/approvals';
import { documentsApi } from '../api/documents';
import type {
  JournalEntry,
  JournalVoucherInput,
  OpenPayable,
  PendingVoucher,
  VoucherRecord,
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
  /** Vouchers awaiting a second pair of eyes. */
  pendingVouchers: PendingVoucher[];
  /** The voucher the last submit created, for the number it was given. */
  lastSubmitted: VoucherRecord | null;
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
    pendingVouchers: [],
    lastSubmitted: null,
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
    /**
     * Submits for approval — the ledger is untouched until the route completes.
     *
     * The created voucher is kept so the form can name the DOCUMENT NUMBER it was given: a voucher
     * now travels through several hands, and "submitted" without a number leaves its author nothing
     * to follow it by.
     */
    async submitVoucher(dto: JournalVoucherInput) {
      this.lastSubmitted = null;
      return this.write(async () => {
        this.lastSubmitted = await journalApi.submitVoucher(dto);
      });
    },

    async loadPendingVouchers() {
      this.loading = true;
      this.error = '';
      try {
        this.pendingVouchers = await journalApi.pendingVouchers();
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    /**
     * Approve, reject or cancel — through the document the voucher rides on.
     *
     * The id is the DOCUMENT's, not the voucher's, because the route belongs to the document: who
     * may act, whether they are acting as somebody's delegate, and how many approvals the amount
     * asks for are all decided there. A voucher-shaped endpoint beside it would have to answer the
     * same questions a second time.
     */
    actOnVoucher(documentId: string, action: ApprovalAction, remark?: string) {
      return this.write(
        () => approvalsApi.act(documentId, { action, remark }),
        () => this.loadPendingVouchers(),
      );
    },
    cancelVoucher(documentId: string) {
      return this.write(
        () => documentsApi.cancel(documentId),
        () => this.loadPendingVouchers(),
      );
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
