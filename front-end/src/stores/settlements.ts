import { defineStore } from 'pinia';
import { settlementsApi } from '../api/settlements';
import type { RecordSettlementInput, UnsettledDocument } from '../api/settlements';
import { messageOf } from '../utils/apiError';

interface SettlementsState {
  unsettled: UnsettledDocument[];
  loading: boolean;
  error: string;
}

/**
 * The unsettled queue and the record action. Mirrors the payments store, kept separate on purpose:
 * settlement (`document_settlement`) and payment (`payment`) are different acts and must not be
 * confused — the confusion this capability exists to fix.
 */
export const useSettlementsStore = defineStore('settlements', {
  state: (): SettlementsState => ({ unsettled: [], loading: false, error: '' }),
  actions: {
    async loadUnsettled() {
      this.loading = true;
      this.error = '';
      try {
        this.unsettled = await settlementsApi.unsettled();
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    /** Record a settlement; on success the document leaves the queue. Returns true, or false on error. */
    async record(documentId: string, input: RecordSettlementInput, file: File): Promise<boolean> {
      this.error = '';
      try {
        await settlementsApi.record(documentId, input, file);
        await this.loadUnsettled();
        return true;
      } catch (e) {
        this.error = messageOf(e);
        return false;
      }
    },
  },
});
