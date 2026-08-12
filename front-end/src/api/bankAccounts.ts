import { api } from './client';

/** The company's OWN account at a bank — not `vendor_bank_account`, which is where money goes. */
export interface BankAccountRow {
  id: string;
  name: string;
  bankName: string;
  accountNo: string;
  currency: { code: string };
  glAccount: { id: string; code: string; name: string };
  isActive: boolean;
}

export interface OutstandingPayment {
  paymentId: string;
  documentNo: string | null;
  /** Decimal string. */
  amount: string;
  paidAt?: string;
}

export interface BankReconciliation {
  bankAccount: BankAccountRow;
  /** The GL balance of the bank account's account. */
  glBalance: string;
  items: OutstandingPayment[];
  total: string;
}

export const bankAccountsApi = {
  list: () => api.get<BankAccountRow[]>('/bank-accounts').then((r) => r.data),
  create: (dto: {
    name: string; bankName: string; accountNo: string; currencyCode: string; glAccountId: string;
  }) => api.post<BankAccountRow>('/bank-accounts', dto).then((r) => r.data),
  deactivate: (id: string) => api.delete(`/bank-accounts/${id}`).then((r) => r.data),
  outstanding: (id: string) =>
    api.get<BankReconciliation>(`/bank-accounts/${id}/outstanding`).then((r) => r.data),
  /**
   * Payments in flight naming no bank account. They sit in the clearing balance and belong to no
   * reconciliation — without them it could never be explained.
   */
  unattributed: () =>
    api
      .get<{ items: OutstandingPayment[]; total: string }>('/bank-accounts/unattributed')
      .then((r) => r.data),
  confirmCleared: (paymentId: string, clearedOn: string) =>
    api
      .post(`/bank-accounts/payments/${paymentId}/cleared`, { clearedOn })
      .then((r) => r.data),
};
