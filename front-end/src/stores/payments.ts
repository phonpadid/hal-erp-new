import { defineStore } from 'pinia';
import { paymentsApi } from '../api/payments';
import type { PayableHandoff } from '../api/payments';
import { messageOf } from '../utils/apiError';

interface PaymentsState {
  handoffs: PayableHandoff[];
  loading: boolean;
  error: string;
}

export const usePaymentsStore = defineStore('payments', {
  state: (): PaymentsState => ({ handoffs: [], loading: false, error: '' }),
  actions: {
    async loadHandoffs() {
      this.loading = true;
      this.error = '';
      try {
        this.handoffs = await paymentsApi.handoffs();
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    /** Record a payment at its actual rate (optional WHT); returns the result (or null on error). */
    async recordPayment(documentId: string, actualRate: string, whtTaxCodeId?: string) {
      this.error = '';
      try {
        const result = await paymentsApi.record(documentId, actualRate, whtTaxCodeId);
        await this.loadHandoffs();
        return result;
      } catch (e) {
        this.error = messageOf(e);
        return null;
      }
    },
  },
});
