import { defineStore } from 'pinia';
import { orgApi } from '../api/org';
import type { Company, CurrencyRef, Department, FiscalYear, Holiday } from '../api/org';
import { messageOf } from '../utils/apiError';

interface OrgState {
  companies: Company[];
  companiesTotal: number;
  companiesPage: number;
  companiesLimit: number;
  departments: Department[];
  departmentsTotal: number;
  departmentsPage: number;
  departmentsLimit: number;
  fiscalYears: FiscalYear[];
  fiscalYearsTotal: number;
  fiscalYearsPage: number;
  fiscalYearsLimit: number;
  holidays: Holiday[];
  holidaysTotal: number;
  holidaysPage: number;
  holidaysLimit: number;
  currencies: CurrencyRef[];
  loading: boolean;
  error: string;
}


export const useOrgStore = defineStore('org', {
  state: (): OrgState => ({
    companies: [], companiesTotal: 0, companiesPage: 1, companiesLimit: 20,
    // departments also feed the parent-department <Select>; default to the max page so options aren't truncated.
    departments: [], departmentsTotal: 0, departmentsPage: 1, departmentsLimit: 100,
    fiscalYears: [], fiscalYearsTotal: 0, fiscalYearsPage: 1, fiscalYearsLimit: 20,
    holidays: [], holidaysTotal: 0, holidaysPage: 1, holidaysLimit: 20,
    currencies: [], loading: false, error: '',
  }),
  actions: {
    async loadCompanies(page?: number, limit?: number) {
      this.loading = true;
      this.error = '';
      try {
        const res = await orgApi.companies.list(page ?? this.companiesPage, limit ?? this.companiesLimit);
        this.companies = res.items;
        this.companiesTotal = res.total;
        this.companiesPage = res.page;
        this.companiesLimit = res.limit;
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    async loadDepartments(page?: number, limit?: number) {
      this.loading = true;
      this.error = '';
      try {
        const res = await orgApi.departments.list(page ?? this.departmentsPage, limit ?? this.departmentsLimit);
        this.departments = res.items;
        this.departmentsTotal = res.total;
        this.departmentsPage = res.page;
        this.departmentsLimit = res.limit;
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    async loadFiscalYears(page?: number, limit?: number) {
      this.loading = true;
      this.error = '';
      try {
        const res = await orgApi.fiscalYears.list(page ?? this.fiscalYearsPage, limit ?? this.fiscalYearsLimit);
        this.fiscalYears = res.items;
        this.fiscalYearsTotal = res.total;
        this.fiscalYearsPage = res.page;
        this.fiscalYearsLimit = res.limit;
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    async loadHolidays(page?: number, limit?: number) {
      this.loading = true;
      this.error = '';
      try {
        const res = await orgApi.holidays.list(page ?? this.holidaysPage, limit ?? this.holidaysLimit);
        this.holidays = res.items;
        this.holidaysTotal = res.total;
        this.holidaysPage = res.page;
        this.holidaysLimit = res.limit;
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    async loadCurrencies() {
      try {
        this.currencies = await orgApi.currencies();
      } catch (e) {
        this.error = messageOf(e);
      }
    },

    async loadAll() {
      this.loading = true;
      this.error = '';
      try {
        const [companies, departments, fiscalYears, holidays, currencies] = await Promise.all([
          orgApi.companies.list(this.companiesPage, this.companiesLimit).catch(() => null),
          // departments back the parent-department <Select>; pull the max page so options aren't truncated.
          orgApi.departments.list(this.departmentsPage, this.departmentsLimit).catch(() => null),
          orgApi.fiscalYears.list(this.fiscalYearsPage, this.fiscalYearsLimit).catch(() => null),
          orgApi.holidays.list(this.holidaysPage, this.holidaysLimit).catch(() => null),
          orgApi.currencies().catch(() => []),
        ]);
        if (companies) {
          this.companies = companies.items;
          this.companiesTotal = companies.total;
          this.companiesPage = companies.page;
          this.companiesLimit = companies.limit;
        }
        if (departments) {
          this.departments = departments.items;
          this.departmentsTotal = departments.total;
          this.departmentsPage = departments.page;
          this.departmentsLimit = departments.limit;
        }
        if (fiscalYears) {
          this.fiscalYears = fiscalYears.items;
          this.fiscalYearsTotal = fiscalYears.total;
          this.fiscalYearsPage = fiscalYears.page;
          this.fiscalYearsLimit = fiscalYears.limit;
        }
        if (holidays) {
          this.holidays = holidays.items;
          this.holidaysTotal = holidays.total;
          this.holidaysPage = holidays.page;
          this.holidaysLimit = holidays.limit;
        }
        this.currencies = currencies;
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    async run(fn: () => Promise<unknown>): Promise<boolean> {
      this.error = '';
      try {
        await fn();
        await this.loadAll();
        return true;
      } catch (e) {
        this.error = messageOf(e);
        return false;
      }
    },

    createCompany(dto: unknown) { return this.run(() => orgApi.companies.create(dto)); },
    updateCompany(id: string, dto: unknown) { return this.run(() => orgApi.companies.update(id, dto)); },
    createDepartment(dto: unknown) { return this.run(() => orgApi.departments.create(dto)); },
    updateDepartment(id: string, dto: unknown) { return this.run(() => orgApi.departments.update(id, dto)); },
    createFiscalYear(dto: unknown) { return this.run(() => orgApi.fiscalYears.create(dto)); },
    updateFiscalYear(id: string, dto: unknown) { return this.run(() => orgApi.fiscalYears.update(id, dto)); },
    closeFiscalYear(id: string) { return this.run(() => orgApi.fiscalYears.close(id)); },
    createHoliday(dto: unknown) { return this.run(() => orgApi.holidays.create(dto)); },
    removeHoliday(id: string) { return this.run(() => orgApi.holidays.remove(id)); },
  },
});
