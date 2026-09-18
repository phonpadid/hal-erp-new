import { defineStore } from 'pinia';
import type { LoadStatus } from './loadState';
import { masterDataApi } from '../api/masterData';
import type { Item, Vendor } from '../api/masterData';
import { messageOf } from '../utils/apiError';

type EnabledRow<T> = T & { enabled: boolean };

interface MasterDataState {
  vendors: EnabledRow<Vendor>[];
  vendorsStatus: LoadStatus;
  vendorTotal: number;
  vendorPage: number;
  vendorLimit: number;
  items: EnabledRow<Item>[];
  itemTotal: number;
  itemPage: number;
  itemLimit: number;
  /**
   * The search term the server is answering, per list. Kept in the store rather than passed
   * per call so paging keeps it: page 2 of a search is page 2 of that same search.
   */
  vendorSearch: string;
  itemSearch: string;
  loading: boolean;
  error: string;
}


/**
 * Mark each record with whether it is enabled for the active company, overlaying the
 * per-company fields that live only on the /enabled read (item GL, vendor payment terms)
 * so an updated value survives the reload instead of being dropped back to the group value.
 */
function merge<T extends { id: string }>(all: T[], enabled: T[]): EnabledRow<T>[] {
  const enabledById = new Map(enabled.map((e) => [e.id, e]));
  return all.map((r) => {
    const e = enabledById.get(r.id);
    return { ...r, ...(e ?? {}), enabled: e !== undefined };
  });
}

export const useMasterDataStore = defineStore('masterData', {
  state: (): MasterDataState => ({
    vendors: [], vendorsStatus: 'idle', vendorTotal: 0, vendorPage: 1, vendorLimit: 20,
    items: [], itemTotal: 0, itemPage: 1, itemLimit: 20,
    vendorSearch: '', itemSearch: '',
    loading: false, error: '',
  }),
  actions: {
    async loadVendors(page?: number, limit?: number, search?: string) {
      this.loading = true;
      this.error = '';
      if (search !== undefined) this.vendorSearch = search;
      this.vendorsStatus = 'loading';
      try {
        const [res, enabled] = await Promise.all([
          masterDataApi.vendors.list(
            page ?? this.vendorPage, limit ?? this.vendorLimit, this.vendorSearch || undefined,
          ),
          masterDataApi.vendors.enabled(),
        ]);
        this.vendorPage = res.page;
        this.vendorLimit = res.limit;
        this.vendorTotal = res.total;
        this.vendors = merge(res.items, enabled);
        this.vendorsStatus = 'loaded';
      } catch (e) {
        this.error = messageOf(e);
        // A control picking from this list needs to tell "no vendors" from "could not ask".
        // `error` alone was never read by the documents filter, so the filter said neither.
        this.vendorsStatus = 'failed';
      } finally {
        this.loading = false;
      }
    },

    async loadItems(page?: number, limit?: number, search?: string) {
      this.loading = true;
      this.error = '';
      if (search !== undefined) this.itemSearch = search;
      try {
        const [res, enabled] = await Promise.all([
          masterDataApi.items.list(
            page ?? this.itemPage, limit ?? this.itemLimit, this.itemSearch || undefined,
          ),
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

    /** Resolves to the saved record's code (issued by the server on create), or null on failure. */
    async saveVendor(dto: any, id?: string): Promise<string | null> {
      this.error = '';
      try {
        const saved: any = id
          ? await masterDataApi.vendors.update(id, dto)
          : await masterDataApi.vendors.create(dto);
        await this.loadVendors();
        return saved?.vendorCode ?? '';
      } catch (e) {
        this.error = messageOf(e);
        return null;
      }
    },

    /** Resolves to the saved record's code (issued by the server on create), or null on failure. */
    async saveItem(dto: any, id?: string): Promise<string | null> {
      this.error = '';
      try {
        const saved: any = id
          ? await masterDataApi.items.update(id, dto)
          : await masterDataApi.items.create(dto);
        await this.loadItems();
        return saved?.itemCode ?? '';
      } catch (e) {
        this.error = messageOf(e);
        return null;
      }
    },

    async setVendorEnabled(id: string, on: boolean, paymentTermDays?: number) {
      this.error = '';
      try {
        await (on
          ? masterDataApi.vendors.enable(id, paymentTermDays == null ? {} : { paymentTermDays })
          : masterDataApi.vendors.disable(id));
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        await this.loadVendors();
      }
    },

    /**
     * Enable/disable an item, optionally binding it to a budget. Returns why it failed, or `''`.
     *
     * The reason is RETURNED rather than left in `error`, and that is the point: a refused save
     * leaves the row exactly as it was, which on screen is indistinguishable from "it saved, then
     * did not stick" — and `loadItems` clears `error` on entry, so the reason was wiped before
     * anything could render it. A save could fail in complete silence. Returning it lets the view
     * raise a toast on the row that failed, instead of replacing the whole table with an error
     * panel over one refused toggle.
     */
    async setItemEnabled(id: string, on: boolean, defaultBudgetCode?: string): Promise<string> {
      let failure = '';
      try {
        // The item names a BUDGET (its plan code), never an account: one account is charged by many
        // budgets, so an account cannot say which was meant. The server stamps the account from the
        // budget this resolves to. Passing '' clears the binding; undefined leaves it untouched on
        // a plain re-enable.
        await (on
          ? masterDataApi.items.enable(id, defaultBudgetCode === undefined ? {} : { defaultBudgetCode })
          : masterDataApi.items.disable(id));
      } catch (e) {
        failure = messageOf(e);
      } finally {
        await this.loadItems();
      }
      return failure;
    },
  },
});
