import { api } from './client';

export interface BudgetBalanceRow {
  budgetId: string;
  departmentId: string;
  departmentName: string;
  category: string;
  amountTotal: string;
  adjustIncrease: string;
  adjustDecrease: string;
  transferIn: string;
  transferOut: string;
  reserved: string;
  actual: string;
  released: string;
  available: string;
}
export interface BudgetBalanceGroup {
  departmentId: string;
  departmentName: string;
  category: string;
  amountTotal: string;
  reserved: string;
  actual: string;
  released: string;
  available: string;
}

export interface ApprovalAgingRow {
  documentId: string;
  docNo: string;
  documentType: { code: string; name: string };
  requesterName: string;
  baseTotalAmount: string | null;
  currentStepNo: number;
  stepName: string | null;
  approvers: Array<{ userId: string; username: string }>;
  submittedAt: string | null;
  ageHours: number | null;
  timeInStepHours: number | null;
  slaDueAt: string | null;
  overdue: boolean;
}
export interface ApprovalAgingResult {
  rows: ApprovalAgingRow[];
  byApprover: Array<{ approverId: string; approverName: string; pendingCount: number; oldestAgeHours: number | null }>;
  byStep: Array<{ stepNo: number; stepName: string | null; pendingCount: number; oldestAgeHours: number | null }>;
}

export interface QuotaRemainingRow {
  quotaId: string;
  quotaType: string;
  unit: string;
  departmentName: string | null;
  employeeId: string;
  employeeName: string;
  year: number;
  entitled: string;
  used: string;
  remaining: string;
}

export interface BudgetAuditRow {
  id: string;
  txnType: string;
  amount: string;
  createdAt: string | null;
  budgetId: string;
  category: string;
  departmentName: string;
  documentId: string | null;
  documentNo: string | null;
  remark: string | null;
  actorName: string | null;
}

export interface GroupTotals {
  amountTotal: string;
  reserved: string;
  actual: string;
  released: string;
  available: string;
}
export interface GroupCompanyRow {
  companyId: string;
  companyCode: string;
  companyName: string;
  baseCurrency: string | null;
  rate: string | null;
  rateSource: string | null;
  convertible: boolean;
  nativeTotal: GroupTotals;
  convertedTotal: GroupTotals | null;
}
export interface GroupBudgetBalanceResult {
  currency: string;
  asOf: string;
  companies: GroupCompanyRow[];
  groupTotal: GroupTotals;
}

export interface DocumentSummaryRow {
  documentTypeId: string;
  typeCode: string;
  typeName: string;
  category: string;
  /** The category's configured display name — `category` is a per-company code, not an enum. */
  categoryName: string;
  status: string;
  count: number;
  baseTotal: string;
}
export interface DocumentStatusTotal {
  status: string;
  count: number;
  baseTotal: string;
}
export interface DocumentSummaryResult {
  rows: DocumentSummaryRow[];
  byStatus: DocumentStatusTotal[];
}

export interface SpendByVendorRow {
  vendorId: string;
  vendorName: string;
  count: number;
  baseTotal: string;
  cumulativePct: number;
}

export interface BudgetUtilizationRow {
  departmentId: string;
  departmentName: string;
  amountTotal: string;
  consumed: string;
  available: string;
  /** Null when the department has no budget to measure against — never 0, which reads as unused. */
  utilizationPct: number | null;
}

/** One named cause of an account's difference — what a source type moved without consuming budget. */
export interface ReconciliationCause {
  sourceType: string;
  amount: string;
}

export interface ReconciliationRow {
  accountId: string | null;
  accountCode: string;
  accountName: string | null;
  appropriated: string;
  committed: string;
  consumed: string;
  moved: string;
  difference: string;
  sourcesWithoutBudget: ReconciliationCause[];
  sourcesWithoutBudgetTotal: string;
  capitalisedIntoStock: string;
  postingNeverArrived: string;
  /** Charged to this year's appropriation on a day before the year began. */
  consumedBeforeItsYear: string;
  /** …and on a day after it ended. Kept apart: an early crossing and a late one are different facts. */
  consumedAfterItsYear: string;
  crossings: CrossingConsumption[];
  crossingCount: number;
  /** The only figure this report exists to produce. Anything but zero is worth investigating. */
  unexplained: string;
}

/** One document whose consumption fell outside the year of the appropriation it drew on. */
export interface CrossingConsumption {
  documentId: string;
  documentNo: string | null;
  txnDate: string;
  amount: string;
}

export interface VoucherOnBudgetedAccount {
  entryId: string;
  entryDate: string;
  docNo: string | null;
  memo: string | null;
  amount: string;
}

export interface FiscalYearRef {
  id: string;
  year: number;
  startDate: string;
  endDate: string;
}

export interface BudgetLedgerReconciliation {
  fiscalYear: FiscalYearRef;
  /** The years the report can be run for — returned here because `/fiscal-years` is admin-gated. */
  fiscalYears: FiscalYearRef[];
  rows: ReconciliationRow[];
  vouchersOnBudgetedAccounts: { total: string; entries: VoucherOnBudgetedAccount[] };
}

/** Why a quarter cannot be compared with the one before it. */
export type NoComparison =
  | 'STARTED'
  | 'STOPPED'
  /** Nothing on either side. Distinct from STOPPED, which says it ran and ceased. */
  | 'NO_ACTIVITY'
  | 'NO_EARLIER_QUARTER'
  | 'NOT_STARTED';

/** One month inside a quarter: an amount and nothing else — no label, no comparison. */
export interface MonthFigure {
  /** The month's position in the fiscal year, 1–12 — never a calendar month. */
  month: number;
  consumed: string;
}

export interface QuarterFigure {
  quarter: 1 | 2 | 3 | 4;
  consumed: string;
  /** The three months this quarter contains. They sum to `consumed`. */
  months: MonthFigure[];
  /** The quarter's share of the ANNUAL budget. Null where there is no budget to take a share of. */
  utilizationPct: number | null;
  elapsedDays: number;
  days: number;
  complete: boolean;
  changeAmount: string | null;
  /** Null whenever one side consumed nothing — see `noComparison` for which. */
  changePct: number | null;
  noComparison: NoComparison | null;
  previousConsumed: string | null;
}

export interface BudgetQuarterRow {
  budgetId: string;
  code: string;
  budgetName: string;
  departmentId: string;
  departmentName: string;
  amountTotal: string;
  quarters: QuarterFigure[];
  /** What the year consumed — the sum of the four quarters. */
  yearConsumed: string;
  /** `amountTotal − yearConsumed`. NEGATIVE when overspent; not floored at zero. */
  remaining: string;
  /** Null when there is no budget to measure against — never 0, which reads as untouched. */
  yearUtilizationPct: number | null;
  /** `100 − yearUtilizationPct`, and null wherever that is. */
  remainingPct: number | null;
  overspent: boolean;
}

export interface BudgetQuarterDepartment
  extends Omit<BudgetQuarterRow, 'budgetId' | 'code' | 'budgetName'> {
  budgets: BudgetQuarterRow[];
}

export interface BudgetQuarterReport {
  fiscalYearId: string;
  year: number;
  /** The company day the elapsed figures were measured on. */
  asOf: string;
  departments: BudgetQuarterDepartment[];
}

export const reportsApi = {
  groupBudgetBalance: (params: { currency: string; asOf?: string }) =>
    api.get<GroupBudgetBalanceResult>('/reports/group/budget-balance', { params }).then((r) => r.data),
  budgetBalance: (params: { fiscalYearId?: string; departmentId?: string } = {}) =>
    api.get<{ rows: BudgetBalanceRow[]; groups: BudgetBalanceGroup[] }>('/reports/budget-balance', { params }).then((r) => r.data),
  approvalAging: () => api.get<ApprovalAgingResult>('/reports/approval-aging').then((r) => r.data),
  quotaRemaining: (params: { year?: number } = {}) =>
    api.get<QuotaRemainingRow[]>('/reports/quota-remaining', { params }).then((r) => r.data),
  budgetAudit: (params: { budgetId?: string; departmentId?: string; from?: string; to?: string } = {}) =>
    api.get<BudgetAuditRow[]>('/reports/budget-audit', { params }).then((r) => r.data),
  documentSummary: (params: { documentTypeId?: string; from?: string; to?: string } = {}) =>
    api.get<DocumentSummaryResult>('/reports/document-summary', { params }).then((r) => r.data),
  spendByVendor: (params: { from?: string; to?: string } = {}) =>
    api.get<SpendByVendorRow[]>('/reports/spend-by-vendor', { params }).then((r) => r.data),
  budgetUtilization: (params: { fiscalYearId?: string; departmentId?: string } = {}) =>
    api.get<BudgetUtilizationRow[]>('/reports/budget-utilization', { params }).then((r) => r.data),
  budgetByQuarter: (params: { fiscalYearId?: string; departmentId?: string } = {}) =>
    api.get<BudgetQuarterReport>('/reports/budget-by-quarter', { params }).then((r) => r.data),
  budgetLedgerReconciliation: (params: { fiscalYearId?: string } = {}) =>
    api
      .get<BudgetLedgerReconciliation>('/reports/budget-ledger-reconciliation', { params })
      .then((r) => r.data),
};

/**
 * Download a report's server-rendered CSV with the current filters applied. The export endpoint
 * reuses the report's permission code + scope, so the file can only contain permitted rows. The
 * blob is fetched via the authed client (Bearer token) and saved client-side.
 */
export async function exportReportCsv(
  report: 'budget-audit' | 'quota-remaining' | 'document-summary' | 'spend-by-vendor',
  params: Record<string, string | number | undefined> = {},
): Promise<void> {
  const res = await api.get(`/reports/${report}/export`, { params, responseType: 'blob' });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${report}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
