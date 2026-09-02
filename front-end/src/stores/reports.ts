import { defineStore } from 'pinia';
import { journalApi } from '../api/journal';
import type { SkippedForWantOfBudget } from '../api/journal';
import { reportsApi } from '../api/reports';
import type {
  ApprovalAgingResult,
  BudgetAuditRow,
  BudgetBalanceGroup,
  BudgetBalanceRow,
  BudgetLedgerReconciliation,
  BudgetQuarterReport,
  BudgetUtilizationRow,
  DocumentSummaryResult,
  GroupBudgetBalanceResult,
  QuotaRemainingRow,
  SpendByVendorRow,
} from '../api/reports';
import { messageOf } from '../utils/apiError';

interface ReportsState {
  budgetRows: BudgetBalanceRow[];
  budgetGroups: BudgetBalanceGroup[];
  aging: ApprovalAgingResult | null;
  quota: QuotaRemainingRow[];
  audit: BudgetAuditRow[];
  group: GroupBudgetBalanceResult | null;
  documents: DocumentSummaryResult | null;
  spend: SpendByVendorRow[];
  utilization: BudgetUtilizationRow[];
  quarters: BudgetQuarterReport | null;
  /**
   * The budget-to-ledger reconciliation and the case it is blind to.
   *
   * They live in ONE store, and are loaded together, although one comes from `/reports` and the
   * other from `/journal`. The expenses skipped for want of a budget are not a second report — they
   * are the half of the comparison that reconciles to zero while being most wrong, and a screen
   * that could render the reconciliation without them would certify books that are missing an
   * entire expense.
   */
  reconciliation: BudgetLedgerReconciliation | null;
  skipped: SkippedForWantOfBudget[];
  loading: boolean;
  error: string;
}

/** On-demand operational reports (read-only). Each loader is independent. */
export const useReportsStore = defineStore('reports', {
  state: (): ReportsState => ({
    budgetRows: [], budgetGroups: [], aging: null, quota: [], audit: [], group: null,
    documents: null, spend: [], utilization: [], quarters: null,
    reconciliation: null, skipped: [],
    loading: false, error: '',
  }),
  actions: {
    async run<T>(fn: () => Promise<T>, assign: (v: T) => void) {
      this.loading = true;
      this.error = '';
      try {
        assign(await fn());
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },
    loadBudgetBalance(params: { fiscalYearId?: string; departmentId?: string } = {}) {
      return this.run(() => reportsApi.budgetBalance(params), (d) => {
        this.budgetRows = d.rows;
        this.budgetGroups = d.groups;
      });
    },
    loadApprovalAging() {
      return this.run(() => reportsApi.approvalAging(), (d) => (this.aging = d));
    },
    loadQuotaRemaining(params: { year?: number } = {}) {
      return this.run(() => reportsApi.quotaRemaining(params), (d) => (this.quota = d));
    },
    loadBudgetAudit(params: { budgetId?: string; departmentId?: string; from?: string; to?: string } = {}) {
      return this.run(() => reportsApi.budgetAudit(params), (d) => (this.audit = d));
    },
    loadGroupBudgetBalance(params: { currency: string; asOf?: string }) {
      return this.run(() => reportsApi.groupBudgetBalance(params), (d) => (this.group = d));
    },
    loadDocumentSummary(params: { documentTypeId?: string; from?: string; to?: string } = {}) {
      return this.run(() => reportsApi.documentSummary(params), (d) => (this.documents = d));
    },
    loadSpendByVendor(params: { from?: string; to?: string } = {}) {
      return this.run(() => reportsApi.spendByVendor(params), (d) => (this.spend = d));
    },
    loadBudgetUtilization(params: { fiscalYearId?: string; departmentId?: string } = {}) {
      return this.run(() => reportsApi.budgetUtilization(params), (d) => (this.utilization = d));
    },
    loadBudgetByQuarter(params: { fiscalYearId?: string; departmentId?: string } = {}) {
      return this.run(() => reportsApi.budgetByQuarter(params), (d) => (this.quarters = d));
    },
    /**
     * Both halves, in one action. Loading them separately would let the screen show a clean
     * reconciliation for a moment while the expenses missing from both books had not arrived —
     * which is the one impression this report must never give.
     */
    loadBudgetLedgerReconciliation(params: { fiscalYearId?: string } = {}) {
      return this.run(
        async () => ({
          reconciliation: await reportsApi.budgetLedgerReconciliation(params),
          skipped: await journalApi.skippedForWantOfBudget(),
        }),
        (d) => {
          this.reconciliation = d.reconciliation;
          this.skipped = d.skipped;
        },
      );
    },
  },
});
