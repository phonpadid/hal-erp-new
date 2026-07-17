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

/** One slip: evidence a payment left the bank. The storage key never leaves the server. */
export interface PaymentSlip {
  id: string;
  fileName: string;
  fileSizeKb?: number;
  mimeType?: string;
  uploadedAt?: string;
}

/** Ready-to-pay queue: settled disbursements for accounting to pull. */
export const paymentsApi = {
  handoffs: () => api.get<PayableHandoff[]>('/payments/handoffs').then((r) => r.data),
  // Record an actual payment at its real rate (optionally withholding tax); returns the breakdown.
  record: (documentId: string, actualRate: string, whtTaxCodeId?: string) =>
    api.post<PaymentResult>(`/payments/${documentId}`, { actualRate, whtTaxCodeId }).then((r) => r.data),

  /**
   * Slips: the evidence a payment left the bank. Keyed by DOCUMENT id like the rest of this
   * surface — a payment is unique per document, and the client is never handed the payment's own
   * id. Never parsed by anything; the bank's RESULT file is a different file going the other way.
   */
  slips: {
    list: (documentId: string) =>
      api.get<PaymentSlip[]>(`/payments/${documentId}/slips`).then((r) => r.data),
    upload: (documentId: string, file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api.post<PaymentSlip>(`/payments/${documentId}/slips/upload`, form).then((r) => r.data);
    },
    downloadUrl: (documentId: string, slipId: string) =>
      api.get<{ url: string }>(`/payments/${documentId}/slips/${slipId}/download-url`).then((r) => r.data.url),
    remove: (documentId: string, slipId: string) =>
      api.delete(`/payments/${documentId}/slips/${slipId}`).then(() => undefined),
  },
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
  /**
   * Apply the bank's result FILE: the file says which lines the bank actually paid, so nobody
   * has to retype it. `rates` is documentId → actual rate — the file reports what moved, not the
   * rate we book it at; an omitted rate falls back to the document's locked rate, so a
   * base-currency run needs none. Multipart, because the server parses the bytes.
   */
  importResultFile: (id: string, file: File, rates: Record<string, string> = {}) => {
    const form = new FormData();
    form.append('file', file);
    form.append('rates', JSON.stringify(rates));
    return api
      .post<PaymentBatchDetail>(`/payment-batches/${id}/result-file`, form)
      .then((r) => r.data);
  },
  cancel: (id: string) => api.post<PaymentBatch>(`/payment-batches/${id}/cancel`, {}).then((r) => r.data),
};
