import { defineStore } from 'pinia';
import { taxCodesApi } from '../api/taxCodes';
import type { FileVatReturnDto, SelectableVat, TaxCode, VatReturn, VatSummaryRow } from '../api/taxCodes';
import { messageOf } from '../utils/apiError';

interface TaxCodesState {
  taxCodes: TaxCode[];
  total: number;
  page: number;
  limit: number;
  selectableVat: SelectableVat[];
  vatSummary: VatSummaryRow[];
  vatReturns: VatReturn[];
  filing: string;
  /**
   * The search term the server is answering, per list. Kept in the store rather than passed
   * per call so paging keeps it: page 2 of a search is page 2 of that same search.
   */
  search: string;
  loading: boolean;
  error: string;
}

export const useTaxCodesStore = defineStore('taxCodes', {
  state: (): TaxCodesState => ({
    taxCodes: [], total: 0, page: 1, limit: 20, selectableVat: [], vatSummary: [], vatReturns: [], filing: '', search: '', loading: false, error: '',
  }),
  actions: {
    async loadTaxCodes(page?: number, limit?: number, includeInactive = true, search?: string) {
      this.loading = true;
      this.error = '';
      if (search !== undefined) this.search = search;
      try {
        const res = await taxCodesApi.list(
          page ?? this.page, limit ?? this.limit, includeInactive, this.search || undefined,
        );
        this.page = res.page;
        this.limit = res.limit;
        this.total = res.total;
        this.taxCodes = res.items;
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    async loadSelectableVat() {
      try {
        this.selectableVat = await taxCodesApi.selectableVat();
      } catch (e) {
        this.error = messageOf(e);
      }
    },

    /**
     * The summary and the filings together: a month's figure means something different depending on
     * whether it has been claimed, so the screen must never show one without the other.
     */
    async loadVatSummary() {
      this.loading = true;
      this.error = '';
      try {
        const [summary, returns] = await Promise.all([
          taxCodesApi.vatSummary(),
          taxCodesApi.vatReturns(),
        ]);
        this.vatSummary = summary;
        this.vatReturns = returns;
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    async fileVatReturn(dto: FileVatReturnDto): Promise<boolean> {
      this.error = '';
      this.filing = dto.periodFrom;
      try {
        await taxCodesApi.fileVatReturn(dto);
        // Reloaded rather than pushed onto the list: filing CREDITS VAT_INPUT, so the month's
        // figure itself changes, and a client that only recorded the filing would keep showing the
        // amount it just claimed as still claimable.
        await this.loadVatSummary();
        return true;
      } catch (e) {
        this.error = messageOf(e);
        return false;
      } finally {
        this.filing = '';
      }
    },

    async createTaxCode(dto: unknown): Promise<boolean> {
      this.error = '';
      try {
        await taxCodesApi.create(dto);
        await this.loadTaxCodes();
        return true;
      } catch (e) {
        this.error = messageOf(e);
        return false;
      }
    },

    async updateTaxCode(id: string, dto: unknown): Promise<boolean> {
      this.error = '';
      try {
        await taxCodesApi.update(id, dto);
        await this.loadTaxCodes();
        return true;
      } catch (e) {
        this.error = messageOf(e);
        return false;
      }
    },
  },
});
