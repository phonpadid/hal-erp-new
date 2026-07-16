import { api } from './client';

export interface PayableHandoff {
  documentId: string;
  docNo: string;
  vendorId?: string;
  vendorName?: string;
  /** The approved destination — chosen on the document, never here. */
  payee?: {
    bankAccountId: string;
    bankCode: string;
    accountNo: string;
    accountName: string;
  };
  baseAmount: string;
  glAccounts: string[];
}

export type PaymentBatchStatus = 'DRAFT' | 'EXPORTED' | 'COMPLETED' | 'PARTIAL' | 'CANCELLED';

export interface PaymentBatch {
  id: string;
  status: PaymentBatchStatus;
  format: string;
  payDate?: string;
  filePath?: string;
  exportedAt?: string;
  importedAt?: string;
  createdAt?: string;
  createdBy?: { id: string; username: string };
}

export interface PaymentBatchLine {
  id: string;
  document: { id: string; docNo: string };
  bankCode: string;
  /** Text, always — an account number identifies, it does not measure. */
  accountNo: string;
  accountName: string;
  amount: string;
  whtTaxCode?: { id: string; code: string };
  whtAmount?: string;
  actualRate?: string;
  result?: 'SUCCESS' | 'FAILED' | 'ALREADY_PAID';
  failReason?: string;
}

export interface PaymentBatchDetail {
  batch: PaymentBatch;
  lines: PaymentBatchLine[];
}

/** One line's outcome as the bank reported it, plus the rate finance keyed for it. */
export interface ImportLine {
  documentId: string;
  result: 'SUCCESS' | 'FAILED';
  /** A decimal string, never a JS number. */
  actualRate?: string;
  failReason?: string;
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

/**
 * Payment runs: build from the ready-to-pay queue, export a file for the bank, import its result.
 *
 * `export` is a POST, not a GET: the first call moves the batch to EXPORTED and stores the artifact,
 * so it is not the safe repeatable read its name suggests. It returns the raw bytes as a blob.
 */
export const paymentBatchesApi = {
  list: () => api.get<PaymentBatch[]>('/payment-batches').then((r) => r.data),
  get: (id: string) => api.get<PaymentBatchDetail>(`/payment-batches/${id}`).then((r) => r.data),
  build: (dto: {
    documentIds: string[];
    payDate?: string;
    format?: string;
    lines?: Array<{ documentId: string; whtTaxCodeId?: string }>;
  }) => api.post<PaymentBatch>('/payment-batches', dto).then((r) => r.data),
  export: (id: string) =>
    api
      .post(`/payment-batches/${id}/export`, {}, { responseType: 'blob' })
      .then((r) => ({ blob: r.data as Blob, disposition: String(r.headers['content-disposition'] ?? '') })),
  importResult: (id: string, lines: ImportLine[]) =>
    api.post<PaymentBatchDetail>(`/payment-batches/${id}/result`, { lines }).then((r) => r.data),
  cancel: (id: string) => api.post<PaymentBatch>(`/payment-batches/${id}/cancel`, {}).then((r) => r.data),
};
