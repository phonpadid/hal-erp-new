import { defineStore } from 'pinia';
import { taxCodesApi } from '../api/taxCodes';
import type { SelectableVat, TaxCode, VatSummaryRow } from '../api/taxCodes';
import { messageOf } from '../utils/apiError';

interface TaxCodesState {
  taxCodes: TaxCode[];
  total: number;
  page: number;
  limit: number;
  selectableVat: SelectableVat[];
  vatSummary: VatSummaryRow[];
  loading: boolean;
  error: string;
}

export const useTaxCodesStore = defineStore('taxCodes', {
  state: (): TaxCodesState => ({
    taxCodes: [], total: 0, page: 1, limit: 20, selectableVat: [], vatSummary: [], loading: false, error: '',
  }),
  actions: {
    async loadTaxCodes(page?: number, limit?: number, includeInactive = true) {
      this.loading = true;
      this.error = '';
      try {
        const res = await taxCodesApi.list(page ?? this.page, limit ?? this.limit, includeInactive);
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

    async loadVatSummary() {
      this.loading = true;
      this.error = '';
      try {
        this.vatSummary = await taxCodesApi.vatSummary();
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
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
