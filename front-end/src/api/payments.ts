import { api } from './client';

export interface PayableHandoff {
  documentId: string;
  docNo: string;
  vendorId?: string;
  vendorName?: string;
  baseAmount: string;
  glAccounts: string[];
}

export interface PaymentResult {
  documentId: string;
  lockedRate: string;
  actualRate: string;
  baseLocked: string;
  baseActual: string;
  fxDelta: string;
  fxKind: string;
  whtAmount: string;
}

/** Ready-to-pay queue: settled disbursements for accounting to pull. */
export const paymentsApi = {
  handoffs: () => api.get<PayableHandoff[]>('/payments/handoffs').then((r) => r.data),
  // Record an actual payment at its real rate (optionally withholding tax); returns the breakdown.
  record: (documentId: string, actualRate: string, whtTaxCodeId?: string) =>
    api.post<PaymentResult>(`/payments/${documentId}`, { actualRate, whtTaxCodeId }).then((r) => r.data),
};
