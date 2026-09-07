import { api } from './client';

/** Which payable this is: owed to a supplier, or owed to a person. `null` when the document's type
 *  is paid without booking a payable first — the reader is told that too. */
export type PayableKind = 'TRADE' | 'CLAIM';

/** How the money moved. Decides whether the record needs evidence attached to it. */
export const PAYMENT_METHODS = ['CASH', 'TRANSFER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * Which of the company's OWN accounts a transfer left: the main one or the reserve one.
 *
 * A confirmation by the person recording the payment, not a reference to a configured bank account
 * — the company's accounts are not master data yet, and a picker over an empty list would block
 * finance behind a data-entry project. Asked of a transfer only; cash left no bank account.
 */
export const TRANSFER_SOURCES = ['PRIMARY', 'RESERVE'] as const;
export type TransferSource = (typeof TRANSFER_SOURCES)[number];

export interface PayableHandoff {
  documentId: string;
  docNo: string;
  payableKind: PayableKind | null;
  /** Who is owed — the vendor, or the person a claim relates to. Never the document's author. */
  owedTo?: string;
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
  /**
   * The rate stamped on the document at submit. The record form starts the actual rate here so
   * finance corrects a figure instead of retyping one — which is where a digit gets dropped.
   */
  lockedRate: string;
  /**
   * What the document's transfer slip already says about which account the money left. The record
   * form arrives with the question answered rather than asking it a second time.
   */
  statedTransferFrom?: TransferSource;
  /** The rate the slip says the money converted at, when one says it. */
  statedActualRate?: string;
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
  /** Which account the transfer left, as recorded. Absent for cash. */
  transferFrom?: TransferSource;
}

/** One slip: evidence a payment left the bank. The storage key never leaves the server. */
export interface PaymentSlip {
  id: string;
  fileName: string;
  fileSizeKb?: number;
  mimeType?: string;
  uploadedAt?: string;
  /**
   * Which of the company's own accounts the person attaching this slip said the transfer left.
   * Absent on a slip attached before this was asked, and on one evidencing cash.
   */
  transferFrom?: TransferSource;
  /** The rate they said the money actually converted at. A decimal string, never a JS number. */
  actualRate?: string;
}

/** What restating a document's rate did. `changed` is false when the rate was already that. */
export interface RestatedRate {
  documentId: string;
  from: string;
  to: string;
  changed: boolean;
  baseTotalAmount: string;
  /** Whether the budget hold moved. False when a configured BUDGET_RATE insulates it. */
  budgetReReserved: boolean;
}

/** Transfer-slip state for a document, for the documents-list column. Only CUT_BUDGET documents
 *  are returned by the batch read; a document absent from the map is not a payable. */
export type SlipStatus = 'PENDING' | 'UPLOADED';

/** Ready-to-pay queue: settled disbursements for accounting to pull. */
export const paymentsApi = {
  handoffs: () => api.get<PayableHandoff[]>('/payments/handoffs').then((r) => r.data),

  // Slip state for a page of documents in one round-trip: documentId → 'PENDING' | 'UPLOADED'.
  // Non-payable documents are omitted from the map. Needs PAYMENT_VIEW.
  slipStatus: (documentIds: string[]) =>
    api.post<Record<string, SlipStatus>>('/payments/slip-status', { documentIds }).then((r) => r.data),
  /**
   * Record an actual payment at its real rate; returns the breakdown.
   *
   * Multipart, because the evidence goes WITH the record. A payment no bank batch produced has
   * nothing else proving the money moved, so the server refuses it without a file — and recording
   * first and attaching afterwards would leave a payment nobody is obliged to justify.
   */
  record: (
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
  ) => {
    const form = new FormData();
    form.append('actualRate', input.actualRate);
    if (input.whtTaxCodeId) form.append('whtTaxCodeId', input.whtTaxCodeId);
    if (input.method) form.append('method', input.method);
    if (input.transferFrom) form.append('transferFrom', input.transferFrom);
    if (input.reference) form.append('reference', input.reference);
    if (input.note) form.append('note', input.note);
    if (input.file) form.append('file', input.file);
    return api.post<PaymentResult>(`/payments/${documentId}`, form).then((r) => r.data);
  },

  /**
   * Slips: the evidence a payment left the bank. Keyed by DOCUMENT id like the rest of this
   * surface — a payment is unique per document, and the client is never handed the payment's own
   * id. Never parsed by anything; the bank's RESULT file is a different file going the other way.
   */
  slips: {
    list: (documentId: string) =>
      api.get<PaymentSlip[]>(`/payments/${documentId}/slips`).then((r) => r.data),
    /**
     * Attach a slip, stating which of the company's accounts the transfer left and at what rate
     * the money actually converted.
     *
     * Both travel WITH the file because that is when they are known: whoever attaches the slip is
     * whoever paid, and the bank's rate for that day is on the document in their hand.
     */
    upload: (
      documentId: string,
      file: File,
      stated: { transferFrom?: TransferSource; actualRate?: string } = {},
    ) => {
      const form = new FormData();
      form.append('file', file);
      if (stated.transferFrom) form.append('transferFrom', stated.transferFrom);
      if (stated.actualRate) form.append('actualRate', stated.actualRate);
      return api.post<PaymentSlip>(`/payments/${documentId}/slips/upload`, form).then((r) => r.data);
    },
    /**
     * State the rate on its own, with no file.
     *
     * A correction to a figure and a second copy of a slip already on file are different acts. Tying
     * them together is what silently discarded a rate finance had typed: with nothing new to attach,
     * the value was never sent and the screen showed no error.
     */
    stateRate: (documentId: string, actualRate: string) =>
      api
        .post<RestatedRate>(`/payments/${documentId}/rate`, { actualRate })
        .then((r) => r.data),
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
