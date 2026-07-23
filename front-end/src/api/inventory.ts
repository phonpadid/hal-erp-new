import { api } from './client';
import type { Paginated } from './pagination';

/**
 * Every quantity and cost crosses the wire as a decimal string, never a JS number — the same rule
 * money follows, for the same reason: a JS number silently loses precision, and stock valuation is
 * money by another name.
 */
export interface StockOnHandRow {
  itemId: string;
  itemCode: string;
  itemName: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  qtyOnHand: string;
  qtyReserved: string;
  qtyAvailable: string;
  avgCost: string;
  totalValue: string;
}

export type StockTxnType =
  | 'RESERVE'
  | 'RELEASE'
  | 'ISSUE'
  | 'RECEIVE'
  | 'ADJUST_INCREASE'
  | 'ADJUST_DECREASE'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN';

export interface StockLedgerRow {
  id: string;
  txnType: StockTxnType;
  qty: string;
  unitCost?: string;
  warehouseId: string;
  warehouseCode: string;
  documentId?: string;
  docNo?: string;
  remark?: string;
  createdAt?: string;
  /** Running on-hand after this row. RESERVE/RELEASE leave it unchanged. */
  balanceAfter: string;
}

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

/**
 * Movement types that changed what is physically on the shelf. RESERVE and RELEASE are absent:
 * they move what is AVAILABLE, so a ledger that showed them the same way would make a reader
 * think stock came and went when it never moved.
 */
export const MOVES_ON_HAND: ReadonlySet<StockTxnType> = new Set<StockTxnType>([
  'RECEIVE',
  'ISSUE',
  'ADJUST_INCREASE',
  'ADJUST_DECREASE',
  'TRANSFER_IN',
  'TRANSFER_OUT',
]);

/** True when the movement added to on-hand — used to sign the quantity for display. */
export function isInbound(txnType: StockTxnType): boolean {
  return txnType === 'RECEIVE' || txnType === 'ADJUST_INCREASE' || txnType === 'TRANSFER_IN';
}

export const inventoryApi = {
  onHand: (params: { page?: number; limit?: number; warehouseId?: string; itemId?: string } = {}) =>
    api.get<Paginated<StockOnHandRow>>('/inventory/on-hand', { params }).then((r) => r.data),

  ledger: (params: { itemId: string; warehouseId?: string; page?: number; limit?: number }) =>
    api.get<Paginated<StockLedgerRow>>('/inventory/ledger', { params }).then((r) => r.data),

  /** Repair path: rebuild a balance from its ledger. Gated by INV_MANAGE server-side. */
  recompute: (body: { itemId: string; warehouseId: string }) =>
    api.post<unknown>('/inventory/recompute', body).then((r) => r.data),

  listWarehouses: (params: { page?: number; limit?: number; includeInactive?: boolean } = {}) =>
    api.get<Paginated<Warehouse>>('/warehouses', { params }).then((r) => r.data),

  createWarehouse: (body: { code: string; name: string }) =>
    api.post<Warehouse>('/warehouses', body).then((r) => r.data),

  updateWarehouse: (id: string, body: { name?: string; isActive?: boolean }) =>
    api.patch<Warehouse>(`/warehouses/${id}`, body).then((r) => r.data),

  /** Deactivates rather than deletes — historical movements still reference the warehouse. */
  deactivateWarehouse: (id: string) =>
    api.delete<Warehouse>(`/warehouses/${id}`).then((r) => r.data),
};
