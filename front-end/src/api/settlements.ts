import { api } from './client';

/**
 * Settlement of a document that accrues its expense at approval — the finance surface for
 * documents whose type carries `accrues_on_approval`. This is NOT the payment/Ready-to-Pay flow
 * (`api/payments.ts`): recording a settlement writes one `document_settlement` row, whereas
 * recording a payment writes a `payment` with its FX result. A consumer that reads settlement
 * (e.g. the HAL claim system) reads it from here — `GET /documents/:id/settlement` — so a document
 * "paid" through the payment flow is never seen as settled.
 *
 * Everything here already exists and is enforced server-side (document-engine): CASH-only,
 * one immutable settlement per document, evidence required, and the settle endpoint denied to
 * API keys. These bindings only expose it.
 */

/** A fully approved, accrue-on-approval document with no settlement yet — one row of the queue. */
export interface UnsettledDocument {
  id: string;
  docNo: string;
  /** Base-currency amount as a decimal string — never a JS number. */
  totalAmount?: string;
  approvedAt?: string;
  department: string;
}

/** The only settlement type the server accepts today. Offered as the sole choice in the form. */
export const SETTLEMENT_TYPES = ['CASH'] as const;
export type SettlementType = (typeof SETTLEMENT_TYPES)[number];

/** What `POST /documents/:id/settle` carries, mirroring the server's `RecordSettlementDto`. */
export interface RecordSettlementInput {
  settlementType: SettlementType;
  /** ISO date string. */
  settledAt: string;
  reference?: string;
  note?: string;
}

/** A document's recorded settlement, as `GET /documents/:id/settlement` returns it. */
export interface DocumentSettlement {
  settlementType: string;
  settledAt: string;
  reference?: string;
}

export const settlementsApi = {
  /** The finance queue: accrue-on-approval, COMPLETED documents with no settlement. Needs PAYMENT_MANAGE. */
  unsettled: () => api.get<UnsettledDocument[]>('/documents/unsettled').then((r) => r.data),

  /**
   * A document's settlement, or `null` when it has none. A 404 is the ANSWER "approved, awaiting
   * settlement" — normal for days after approval — so it resolves to null rather than throwing;
   * every other error propagates. Needs DOC_VIEW.
   */
  read: (documentId: string): Promise<DocumentSettlement | null> =>
    api
      .get<DocumentSettlement>(`/documents/${documentId}/settlement`)
      .then((r) => r.data)
      .catch((e) => {
        if (e?.response?.status === 404) return null;
        throw e;
      }),

  /**
   * Record how a settled document was finally paid, with the evidence that proves it. Multipart,
   * because the server stores the file as a `document_attachment`. Needs PAYMENT_MANAGE; the server
   * refuses API-key sessions regardless of grants.
   */
  record: (documentId: string, input: RecordSettlementInput, file: File): Promise<DocumentSettlement> => {
    const form = new FormData();
    form.append('settlementType', input.settlementType);
    form.append('settledAt', input.settledAt);
    if (input.reference) form.append('reference', input.reference);
    if (input.note) form.append('note', input.note);
    form.append('file', file);
    return api.post<DocumentSettlement>(`/documents/${documentId}/settle`, form).then((r) => r.data);
  },
};
