import { defineStore } from 'pinia';
import { masterDataApi } from '../api/masterData';
import type { Item, Vendor } from '../api/masterData';
import { messageOf } from '../utils/apiError';

type EnabledRow<T> = T & { enabled: boolean };

interface MasterDataState {
  vendors: EnabledRow<Vendor>[];
  vendorTotal: number;
  vendorPage: number;
  vendorLimit: number;
  items: EnabledRow<Item>[];
  itemTotal: number;
  itemPage: number;
  itemLimit: number;
  loading: boolean;
  error: string;
}


/** Mark each record with whether it is enabled for the active company. */
function merge<T extends { id: string }>(all: T[], enabled: T[]): EnabledRow<T>[] {
  const enabledIds = new Set(enabled.map((e) => e.id));
  return all.map((r) => ({ ...r, enabled: enabledIds.has(r.id) }));
}

export const useMasterDataStore = defineStore('masterData', {
  state: (): MasterDataState => ({
    vendors: [], vendorTotal: 0, vendorPage: 1, vendorLimit: 20,
    items: [], itemTotal: 0, itemPage: 1, itemLimit: 20,
    loading: false, error: '',
  }),
  actions: {
    async loadVendors(page?: number, limit?: number) {
      this.loading = true;
      this.error = '';
      try {
        const [res, enabled] = await Promise.all([
          masterDataApi.vendors.list(page ?? this.vendorPage, limit ?? this.vendorLimit),
          masterDataApi.vendors.enabled(),
        ]);
        this.vendorPage = res.page;
        this.vendorLimit = res.limit;
        this.vendorTotal = res.total;
        this.vendors = merge(res.items, enabled);
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    async loadItems(page?: number, limit?: number) {
      this.loading = true;
      this.error = '';
      try {
        const [res, enabled] = await Promise.all([
          masterDataApi.items.list(page ?? this.itemPage, limit ?? this.itemLimit),
          masterDataApi.items.enabled(),
        ]);
        this.itemPage = res.page;
        this.itemLimit = res.limit;
        this.itemTotal = res.total;
        this.items = merge(res.items, enabled);
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    async saveVendor(dto: any, id?: string): Promise<boolean> {
      this.error = '';
      try {
        if (id) await masterDataApi.vendors.update(id, dto);
        else await masterDataApi.vendors.create(dto);
        await this.loadVendors();
        return true;
      } catch (e) {
        this.error = messageOf(e);
        return false;
      }
    },

    async saveItem(dto: any, id?: string): Promise<boolean> {
      this.error = '';
      try {
        if (id) await masterDataApi.items.update(id, dto);
        else await masterDataApi.items.create(dto);
        await this.loadItems();
        return true;
      } catch (e) {
        this.error = messageOf(e);
        return false;
      }
    },

    async setVendorEnabled(id: string, on: boolean) {
      this.error = '';
      try {
        await (on ? masterDataApi.vendors.enable(id) : masterDataApi.vendors.disable(id));
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        await this.loadVendors();
      }
    },

    async setItemEnabled(id: string, on: boolean) {
      this.error = '';
      try {
        await (on ? masterDataApi.items.enable(id) : masterDataApi.items.disable(id));
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        await this.loadItems();
      }
    },
  },
});
