import { api } from './client';
import type { Paginated } from './pagination';
import type { ItemInput, VendorInput } from '@erp/shared';

export interface Vendor extends VendorInput {
  id: string;
  isActive?: boolean;
  // `paymentTermDays` on the /enabled read is the per-company effective value (override ?? group).
  // Whether the vendor has any ACTIVE bank account — present on the registry read. False means a
  // disbursement for this vendor cannot be submitted at all, since DISB requires a payee.
  hasBankAccount?: boolean;
}
export interface Item extends ItemInput {
  id: string;
  isActive?: boolean;
  // Whether the item moves stock. Present on the /enabled read; the line editor filters on it for
  // stock-moving document types.
  isStockTracked?: boolean;
  // `defaultGlAccount` is present only on the /enabled read — the item's GL for the active company.
  defaultGlAccount?: string;
}

function crud<T>(base: string) {
  return {
    list: (page = 1, limit = 20, search?: string) =>
      api.get<Paginated<T>>(base, { params: { page, limit, search } }).then((r) => r.data),
    enabled: () => api.get<T[]>(`${base}/enabled`).then((r) => r.data),
    create: (dto: unknown) => api.post(base, dto).then((r) => r.data),
    update: (id: string, dto: unknown) => api.patch(`${base}/${id}`, dto).then((r) => r.data),
    // Enable may carry per-company options (item GL / vendor payment terms).
    enable: (id: string, body: Record<string, unknown> = {}) =>
      api.post(`${base}/${id}/enable`, body).then((r) => r.data),
    disable: (id: string) => api.post(`${base}/${id}/disable`, {}).then((r) => r.data),
    remove: (id: string) => api.delete(`${base}/${id}`).then((r) => r.data),
  };
}

/** One recorded change to an account: who, when, and from what to what. */
export interface VendorBankAccountHistoryEntry {
  id: string;
  action: 'CREATE' | 'UPDATE' | 'SET_PRIMARY' | 'DEACTIVATE';
  actor: { id: string; username: string };
  actedAt?: string;
  before: { bankCode: string; accountNo: string; accountName: string } | null;
  after: { bankCode: string; accountNo: string; accountName: string } | null;
}

/** A vendor's payee bank account. `accountNo` is a string, always — an identifier, not a number. */
export interface VendorBankAccount {
  id: string;
  bankCode: string;
  accountNo: string;
  accountName: string;
  currency?: string;
  isPrimary: boolean;
  isActive: boolean;
}

export const masterDataApi = {
  vendors: crud<Vendor>('/vendors'),
  items: crud<Item>('/items'),
  /**
   * A vendor's bank accounts. Reads need only MASTER_VIEW; every mutation needs the separate
   * VENDOR_BANK_MANAGE — redirecting a payee account needs no approval and pays out on the next
   * run, so it must not ride along with editing a vendor's contact details.
   *
   * Inactive accounts come back too, so a document naming one stays legible; a payee picker filters
   * to active itself.
   */
  vendorBankAccounts: {
    list: (vendorId: string) =>
      api.get<VendorBankAccount[]>(`/vendors/${vendorId}/bank-accounts`).then((r) => r.data),
    create: (vendorId: string, dto: unknown) =>
      api.post<VendorBankAccount>(`/vendors/${vendorId}/bank-accounts`, dto).then((r) => r.data),
    update: (vendorId: string, id: string, dto: unknown) =>
      api.patch<VendorBankAccount>(`/vendors/${vendorId}/bank-accounts/${id}`, dto).then((r) => r.data),
    setPrimary: (vendorId: string, id: string) =>
      api.patch<VendorBankAccount>(`/vendors/${vendorId}/bank-accounts/${id}/primary`, {}).then((r) => r.data),
    deactivate: (vendorId: string, id: string) =>
      api.patch<VendorBankAccount>(`/vendors/${vendorId}/bank-accounts/${id}/deactivate`, {}).then((r) => r.data),
    // Gated on VENDOR_BANK_MANAGE, not MASTER_VIEW: who redirected a payee is more sensitive than
    // the account list itself.
    history: (vendorId: string, id: string) =>
      api
        .get<VendorBankAccountHistoryEntry[]>(`/vendors/${vendorId}/bank-accounts/${id}/history`)
        .then((r) => r.data),
  },
};
