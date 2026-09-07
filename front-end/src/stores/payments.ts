import { defineStore } from 'pinia';
import { paymentsApi } from '../api/payments';
import type { PayableHandoff, PaymentMethod, TransferSource } from '../api/payments';
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

    /**
     * Record a payment; returns the result (or null on error).
     *
     * The evidence travels with it. The server refuses a payment no batch produced without a file,
     * and the message it returns is left unaltered — it names what is missing.
     */
    async recordPayment(
      documentId: string,
      input: {
        actualRate: string;
        whtTaxCodeId?: string;
        method?: PaymentMethod;
        transferFrom?: TransferSource;
        reference?: string;
        note?: string;
        file?: File;
      },
    ) {
      this.error = '';
      try {
        const result = await paymentsApi.record(documentId, input);
        await this.loadHandoffs();
        return result;
      } catch (e) {
        this.error = messageOf(e);
        return null;
      }
    },
  },
});
