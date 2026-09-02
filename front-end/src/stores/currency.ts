import { defineStore } from 'pinia';
import { currencyApi } from '../api/currency';
import type { Currency, ExchangeRate, RateFilter, SelectableCurrency } from '../api/currency';
import { messageOf } from '../utils/apiError';

interface CurrencyState {
  currencies: Currency[];
  /** Full currency list for the admin rate <Select> options — decoupled from the paged table so the
   * dropdowns never truncate to the current page. */
  currencyOptions: Currency[];
  /** Active currencies for pickers/formatting — DOC_CREATE read, kept apart from the admin list. */
  selectableCurrencies: SelectableCurrency[];
  currencyTotal: number;
  currencyPage: number;
  currencyLimit: number;
  rates: ExchangeRate[];
  rateTotal: number;
  ratePage: number;
  rateLimit: number;
  rateFilter: RateFilter;
  /**
   * The search term the server is answering, per list. Kept in the store rather than passed
   * per call so paging keeps it: page 2 of a search is page 2 of that same search.
   */
  currencySearch: string;
  loading: boolean;
  error: string;
}


export const useCurrencyStore = defineStore('currency', {
  state: (): CurrencyState => ({
    currencies: [], currencyOptions: [], selectableCurrencies: [], currencyTotal: 0, currencyPage: 1, currencyLimit: 20,
    rates: [], rateTotal: 0, ratePage: 1, rateLimit: 20,
    rateFilter: {}, currencySearch: '', loading: false, error: '',
  }),
  actions: {
    // Active currencies for the document-creation picker and money formatting. Uses the
    // DOC_CREATE-gated read so a creator without CURRENCY_VIEW isn't blocked; kept in its own
    // state so it never clobbers the admin (paginated, incl. inactive) list.
    async loadSelectableCurrencies() {
      try {
        this.selectableCurrencies = await currencyApi.currencies.selectable();
      } catch (e) {
        this.error = messageOf(e);
      }
    },
    // Server-side paging: honor the page + rows the table asks for (AppDataTable contract).
    async loadCurrencies(page?: number, limit?: number, search?: string) {
      this.loading = true;
      this.error = '';
      if (search !== undefined) this.currencySearch = search;
      try {
        const res = await currencyApi.currencies.list(
          page ?? this.currencyPage, limit ?? this.currencyLimit, this.currencySearch || undefined,
        );
        this.currencyPage = res.page;
        this.currencyLimit = res.limit;
        this.currencyTotal = res.total;
        this.currencies = res.items;
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },
    // Full list (max page size) for the rate <Select> options — decoupled from the paged table
    // so the From/To and add-rate dropdowns never truncate to the current page.
    async loadCurrencyOptions() {
      try {
        this.currencyOptions = (await currencyApi.currencies.list(1, 100)).items;
      } catch (e) {
        this.error = messageOf(e);
      }
    },

    async loadRates(filter: RateFilter = {}, page?: number, limit?: number) {
      this.rateFilter = filter;
      this.loading = true;
      this.error = '';
      try {
        const res = await currencyApi.rates.list(filter, page ?? this.ratePage, limit ?? this.rateLimit);
        this.ratePage = res.page;
        this.rateLimit = res.limit;
        this.rateTotal = res.total;
        this.rates = res.items;
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    async createCurrency(dto: unknown): Promise<boolean> {
      this.error = '';
      try {
        await currencyApi.currencies.create(dto);
        await Promise.all([this.loadCurrencies(), this.loadCurrencyOptions()]);
        return true;
      } catch (e) {
        this.error = messageOf(e);
        return false;
      }
    },

    async updateCurrency(code: string, dto: unknown): Promise<boolean> {
      this.error = '';
      try {
        await currencyApi.currencies.update(code, dto);
        await Promise.all([this.loadCurrencies(), this.loadCurrencyOptions()]);
        return true;
      } catch (e) {
        this.error = messageOf(e);
        return false;
      }
    },

    async addRate(dto: unknown): Promise<boolean> {
      this.error = '';
      try {
        await currencyApi.rates.create(dto);
        await this.loadRates(this.rateFilter); // keep the active filter on refresh
        return true;
      } catch (e) {
        this.error = messageOf(e);
        return false;
      }
    },
  },
});
