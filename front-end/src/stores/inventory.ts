import { defineStore } from 'pinia';
import { inventoryApi } from '../api/inventory';
import type { StockLedgerRow, StockOnHandRow, Warehouse } from '../api/inventory';
import { messageOf } from '../utils/apiError';

interface InventoryState {
  onHand: StockOnHandRow[];
  total: number;
  page: number;
  limit: number;
  warehouseFilter: string;

  ledger: StockLedgerRow[];
  ledgerTotal: number;
  ledgerPage: number;
  ledgerLimit: number;
  ledgerItemId: string;
  ledgerItemLabel: string;

  warehouses: Warehouse[];
  warehousesTotal: number;
  warehousesPage: number;
  warehousesLimit: number;

  loading: boolean;
  error: string;
}

/**
 * Company-scoped stock state. Every quantity and cost stays a decimal string end to end — the
 * store never coerces one to a number, so precision survives all the way to the formatter.
 */
export const useInventoryStore = defineStore('inventory', {
  state: (): InventoryState => ({
    onHand: [], total: 0, page: 1, limit: 20, warehouseFilter: '',
    ledger: [], ledgerTotal: 0, ledgerPage: 1, ledgerLimit: 20, ledgerItemId: '', ledgerItemLabel: '',
    warehouses: [], warehousesTotal: 0, warehousesPage: 1, warehousesLimit: 20,
    loading: false, error: '',
  }),

  actions: {
    async loadOnHand(page?: number, limit?: number) {
      this.loading = true;
      this.error = '';
      try {
        const res = await inventoryApi.onHand({
          page: page ?? this.page,
          limit: limit ?? this.limit,
          warehouseId: this.warehouseFilter || undefined,
        });
        this.onHand = res.items;
        this.total = res.total;
        this.page = res.page;
        this.limit = res.limit;
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    /** Narrow to one warehouse. Resets to page 1: a filtered page 3 is rarely what was meant. */
    async setWarehouseFilter(warehouseId: string) {
      this.warehouseFilter = warehouseId;
      await this.loadOnHand(1);
    },

    async loadLedger(itemId: string, label: string, page?: number, limit?: number) {
      this.loading = true;
      this.error = '';
      this.ledgerItemId = itemId;
      this.ledgerItemLabel = label;
      try {
        const res = await inventoryApi.ledger({
          itemId,
          warehouseId: this.warehouseFilter || undefined,
          page: page ?? 1,
          limit: limit ?? this.ledgerLimit,
        });
        this.ledger = res.items;
        this.ledgerTotal = res.total;
        this.ledgerPage = res.page;
        this.ledgerLimit = res.limit;
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    async loadWarehouses(page?: number, limit?: number, includeInactive = false) {
      this.loading = true;
      this.error = '';
      try {
        const res = await inventoryApi.listWarehouses({
          page: page ?? this.warehousesPage,
          limit: limit ?? this.warehousesLimit,
          includeInactive,
        });
        this.warehouses = res.items;
        this.warehousesTotal = res.total;
        this.warehousesPage = res.page;
        this.warehousesLimit = res.limit;
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    async createWarehouse(body: { code: string; name: string }, includeInactive = false) {
      await inventoryApi.createWarehouse(body);
      await this.loadWarehouses(1, undefined, includeInactive);
    },

    async updateWarehouse(
      id: string,
      body: { name?: string; isActive?: boolean },
      includeInactive = false,
    ) {
      await inventoryApi.updateWarehouse(id, body);
      await this.loadWarehouses(undefined, undefined, includeInactive);
    },

    async deactivateWarehouse(id: string, includeInactive = false) {
      await inventoryApi.deactivateWarehouse(id);
      await this.loadWarehouses(undefined, undefined, includeInactive);
    },
  },
});
