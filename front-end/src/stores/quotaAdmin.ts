import { defineStore } from 'pinia';
import { quotaAdminApi, quotasApi } from '../api/quotas';
import type { EntitlementRow, QuotaSummary } from '../api/quotas';
import { employeesApi } from '../api/employees';
import { orgApi } from '../api/org';
import { messageOf } from '../utils/apiError';

interface Option {
  id: string;
  name: string;
}

/** Normalized header context for the per-quota entitlements detail screen. */
interface QuotaContext {
  quotaType: string;
  unit: string;
  limitValue: string;
  resetCycle: string;
  carryForward: boolean;
  levelName: string; // '' => company-wide
  poolRemaining: string;
}

interface QuotaAdminState {
  list: Array<QuotaSummary & { remaining?: string }>;
  total: number;
  page: number;
  limit: number;
  departments: Option[];
  employees: Option[];
  selectedQuotaId: string;
  entitlementYear: number;
  entitlements: EntitlementRow[];
  quotaContext: QuotaContext | null;
  loading: boolean;
  error: string;
}

const currentYear = new Date().getUTCFullYear();

export const useQuotaAdminStore = defineStore('quotaAdmin', {
  state: (): QuotaAdminState => ({
    list: [],
    total: 0,
    page: 1,
    limit: 20,
    departments: [],
    employees: [],
    selectedQuotaId: '',
    entitlementYear: currentYear,
    entitlements: [],
    quotaContext: null,
    loading: false,
    error: '',
  }),
  actions: {
    async loadList(page?: number, limit?: number) {
      this.loading = true;
      this.error = '';
      try {
        const res = await quotasApi.list(page ?? this.page, limit ?? this.limit);
        this.total = res.total;
        this.page = res.page;
        this.limit = res.limit;
        // `remaining` is now computed server-side per row (one batched pass), so the list
        // renders without the old per-row breakdown fetch (N+1).
        this.list = res.items;
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    async loadOptions() {
      try {
        const [depts, emps] = await Promise.all([
          orgApi.departments.list(1, 100),
          employeesApi.list(1, 100),
        ]);
        this.departments = depts.items.map((d) => ({ id: d.id, name: d.name }));
        this.employees = emps.items.map((e) => ({ id: e.id, name: `${e.empCode} · ${e.fullName}` }));
      } catch {
        // Non-fatal: a QUOTA_MANAGE user may lack org/employee read — leave options empty.
      }
    },

    async create(dto: unknown): Promise<boolean> {
      return this.run(async () => {
        await quotaAdminApi.create(dto);
        await this.loadList();
      });
    },

    async update(id: string, dto: unknown): Promise<boolean> {
      return this.run(async () => {
        await quotaAdminApi.update(id, dto);
        await this.loadList();
      });
    },

    async deactivate(id: string): Promise<boolean> {
      return this.run(async () => {
        await quotaAdminApi.deactivate(id);
        await this.loadList();
      });
    },

    /**
     * Load the header context (identity + pool remaining) for a quota's detail
     * screen. Sourced from the breakdown endpoint so a deep-linked/refreshed page
     * works without the list having run; `carryForward` (absent from the breakdown)
     * comes from the loaded list row, else a full quota fetch.
     */
    async loadQuotaContext(quotaId: string) {
      try {
        const bd = await quotasApi.breakdown(quotaId);
        const fromList = this.list.find((q) => q.id === quotaId);
        let carryForward = fromList?.carryForward;
        if (carryForward === undefined) {
          const full = (await quotasApi.get(quotaId)) as QuotaSummary;
          carryForward = full.carryForward;
        }
        this.quotaContext = {
          quotaType: bd.quota.quotaType,
          unit: bd.quota.unit,
          limitValue: bd.quota.limitValue,
          resetCycle: bd.quota.resetCycle,
          carryForward: carryForward ?? true,
          levelName: bd.quota.departmentName ?? '',
          poolRemaining: bd.pool.remaining,
        };
      } catch (e) {
        this.error = messageOf(e);
      }
    },

    async loadEntitlements(quotaId: string, year?: number) {
      this.selectedQuotaId = quotaId;
      if (year !== undefined) this.entitlementYear = year;
      this.loading = true;
      this.error = '';
      try {
        this.entitlements = await quotaAdminApi.entitlements(quotaId, this.entitlementYear);
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    async upsertEntitlement(dto: unknown): Promise<boolean> {
      return this.run(async () => {
        await quotaAdminApi.upsertEntitlement(dto);
        await this.loadEntitlements(this.selectedQuotaId);
      });
    },

    async adjustEntitlement(dto: unknown): Promise<boolean> {
      return this.run(async () => {
        await quotaAdminApi.adjustEntitlement(dto);
        await this.loadEntitlements(this.selectedQuotaId);
      });
    },

    async carryForward(dto: unknown): Promise<boolean> {
      return this.run(async () => {
        await quotaAdminApi.carryForward(dto);
        await this.loadEntitlements(this.selectedQuotaId);
      });
    },

    /** Run a mutating action, capturing errors into `error`. Returns success. */
    async run(fn: () => Promise<void>): Promise<boolean> {
      this.error = '';
      try {
        await fn();
        return true;
      } catch (e) {
        this.error = messageOf(e);
        return false;
      }
    },
  },
});
