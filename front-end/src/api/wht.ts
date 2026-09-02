import { api } from './client';

/** One withholding, certified. The payee quotes `certificateNo` when claiming the deduction. */
export interface WhtCertificateRow {
  id: string;
  certificateNo: string;
  vendor?: { id: string; name: string } | null;
  taxCode?: { id: string; code: string } | null;
  /** Decimal strings. */
  rate: string;
  baseAmount: string;
  whtAmount: string;
  issuedOn: string;
  remittanceId?: string | null;
  remittedOn?: string | null;
}

export const whtApi = {
  /** Certificates issued and not yet remitted, with their total — what is still owed. */
  outstanding: () =>
    api
      .get<{ items: WhtCertificateRow[]; total: string }>('/wht/outstanding')
      .then((r) => r.data),
  certify: (paymentId: string, issuedOn?: string) =>
    api
      .post<WhtCertificateRow>(`/wht/payments/${paymentId}/certificate`, { issuedOn })
      .then((r) => r.data),
  /** Clears WHT_PAYABLE by the certificates' total, not by the account's balance. */
  remit: (certificateIds: string[], remittedOn: string) =>
    api
      .post<{ remittanceId: string; total: string; count: number }>('/wht/remittances', {
        certificateIds,
        remittedOn,
      })
      .then((r) => r.data),
};
