import { api } from './client';
import type { Paginated } from './pagination';
import type { BudgetCreateInput, BudgetTransferInput, BudgetUpdateInput } from '@erp/shared';

export interface CurrencyRef {
  code?: string;
  decimalPlaces?: number;
}

/**
 * Where a budget's money sits in the plan — a place, not money.
 *
 * A node carries no amount, no status and no approval. Categories are nodes, which is why a budget
 * row always holds an amount of its own and a rollup is never mistaken for one.
 */
export interface BudgetNodeRef {
  id: string;
  code: string;
  name?: string;
  parent?: { id: string } | string | null;
}

export interface BudgetSummary {
  id: string;
  /** The budget's identity: the place in the plan its money sits at. */
  node: BudgetNodeRef;
  /** Optional hint: a budget whose spending posts to several accounts records none. */
  glAccount?: string;
  budgetName?: string;
  /** Every row in this table is an appropriation, so every row holds an amount. */
  amountTotal: string;
  status: string;
  /** Derived available balance, computed server-side per row (see BudgetService.list). */
  available?: string;
  fiscalYear?: { year?: number; company?: { baseCurrency?: CurrencyRef | null } };
  department?: { name?: string };
}

/** A node as the tree pickers and the plan screens read it. */
export interface BudgetNodeView {
  id: string;
  code: string;
  name?: string;
  parentId?: string;
  fiscalYearId: string;
  /** Budgets hanging off this node — a category has none of its own. */
  budgetCount: number;
  /** Nodes beneath it. Zero means a line; more than zero means a category. */
  childCount: number;
}

/** Minimal budget shape for the Create Document per-line picker — no amounts (DOC_CREATE read). */
export interface SelectableBudget {
  id: string;
  code: string;
  budgetName?: string;
  parentId?: string;
  /**
   * The category this budget sits under. Optional together with `parentId`: a node with no parent
   * carries none of the three, and the picker groups those separately.
   *
   * The name is here because `parentId` alone names a row this read never returns — a category
   * holds no money, so it is not a selectable budget. It is a label, not a figure; this read
   * carries no amounts by design.
   */
  parentCode?: string;
  parentName?: string;
}

export interface BalanceBreakdown {
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

/** One rung of a control point's tolerance ladder. */
export interface ToleranceRung {
  at: number;
  action: 'WARN' | 'BLOCK';
}

/**
 * A control point governing a budget, with the amount available AT that point.
 *
 * This — not the budget's own available — is what decides whether a document charging the budget
 * can be submitted. A budget can show plenty of room and still be refused by an ancestor node.
 */
export interface GoverningControlPoint {
  id: string;
  fiscalYearId: string;
  budgetNodeId: string;
  budgetNodeCode: string;
  budgetNodeName: string;
  departmentNodeId: string;
  departmentNodeCode: string;
  departmentNodeName: string;
  capAmount: string | null;
  tolerance: ToleranceRung[];
  isActive: boolean;
  available: string;
}

/**
 * A control point as a LIST row: configuration plus the figures the screen has to show.
 *
 * A control point has no budget row of its own, so these derived fields are the only place a list
 * can get a ceiling from. `governedBudgetIds` lets a caller that already holds the budget list
 * group it without a request per budget.
 */
export interface ControlPointSummary extends GoverningControlPoint {
  ceiling: string;
  used: string;
  governedBudgetIds: string[];
}

/** A control point's derived balance, same components as a budget breakdown. */
export interface ControlPointBalance extends BalanceBreakdown {
  governedBudgetCount: number;
}

export interface LedgerEntry {
  id: string;
  txnType: string;
  amount: string;
  documentId: string | null;
  documentNo: string | null;
  remark: string | null;
  createdAt: string | null;
}

export interface CreateAdjustmentInput {
  direction: 'INCREASE' | 'DECREASE';
  amount: string;
  reason: string;
  // Set only when the company has more than one type for the direction; the server auto-uses
  // the single configured type otherwise.
  documentTypeId?: string;
}

/** Selection fields for a movement document type (no config/behavior leaks). */
export interface MovementDocTypeOption {
  id: string;
  code: string;
  name: string;
}

/** Active movement document types grouped by operation, for the active company. */
export interface MovementDocTypes {
  adjustIncrease: MovementDocTypeOption[];
  adjustDecrease: MovementDocTypeOption[];
  transfer: MovementDocTypeOption[];
}

/**
 * Everything that narrows the budget list, in one object.
 *
 * Together rather than as three more positional parameters: they are one idea — what the reader
 * asked to see — they compose as a conjunction, and a call site reads better naming them than
 * counting commas.
 */
export interface BudgetListFilters {
  search?: string;
  departmentId?: string;
  status?: string;
}

/** A department offered by the budget list's filter. Identifying fields only, never a figure. */
export interface FilterDepartment {
  id: string;
  deptCode: string;
  name: string;
}

/** Budget views plus BUDGET_MANAGE affordances (create/edit, transfer, adjustment). */
export const budgetsApi = {
  list: (page = 1, limit = 20, narrow: BudgetListFilters = {}) =>
    api.get<Paginated<BudgetSummary>>('/budgets', { params: { page, limit, ...narrow } }).then((r) => r.data),
  /**
   * Options for the department filter — BUDGET_VIEW, the same gate as the list.
   *
   * Deliberately NOT `/departments`, which needs DEPARTMENT_VIEW: a department head reading
   * budgets need not hold it, and would get an empty filter with nothing on screen to say why.
   */
  filterDepartments: () =>
    api.get<FilterDepartment[]>('/budgets/filter-departments').then((r) => r.data),
  // Budget picker for document creation — gated by DOC_CREATE (not BUDGET_VIEW); returns no
  // amounts. Used by the Create Document wizard to let a requester charge a line to a budget.
  selectable: (departmentId?: string) =>
    api
      .get<SelectableBudget[]>('/budgets/selectable', {
        params: departmentId ? { departmentId } : undefined,
      })
      .then((r) => r.data),
  // The plan's structure. Read with DOC_CREATE (a requester picks a budget by its plan code);
  // writing a node needs BUDGET_MANAGE.
  nodes: (fiscalYearId?: string) =>
    api
      .get<BudgetNodeView[]>('/budgets/nodes', { params: fiscalYearId ? { fiscalYearId } : undefined })
      .then((r) => r.data),
  createNode: (input: { fiscalYearId: string; code: string; name?: string; parentId?: string }) =>
    api.post<BudgetNodeView>('/budgets/nodes', input).then((r) => r.data),
  updateNode: (id: string, input: { name?: string; parentId?: string | null }) =>
    api.patch<BudgetNodeView>(`/budgets/nodes/${id}`, input).then((r) => r.data),
  get: (id: string) => api.get(`/budgets/${id}`).then((r) => r.data),
  breakdown: (id: string) => api.get<BalanceBreakdown>(`/budgets/${id}/breakdown`).then((r) => r.data),
  // The control points that actually gate spending on this budget (BUDGET_VIEW).
  controlPoints: (id: string) =>
    api.get<GoverningControlPoint[]>(`/budgets/${id}/control-points`).then((r) => r.data),
  // Every control point in the company, with its derived figures (BUDGET_VIEW). Pass a fiscal year
  // to scope it — a ceiling is a per-year figure, so mixing years puts two unrelated numbers for
  // one category in one list.
  controlPointList: (fiscalYearId?: string) =>
    api
      .get<ControlPointSummary[]>('/budgets/control-points', {
        params: fiscalYearId ? { fiscalYearId } : undefined,
      })
      .then((r) => r.data),
  controlPointBalance: (id: string) =>
    api.get<ControlPointBalance>(`/budgets/control-points/${id}/balance`).then((r) => r.data),
  ledger: (id: string, page = 1, limit = 20) =>
    api
      .get<Paginated<LedgerEntry>>(`/budgets/${id}/ledger`, { params: { page, limit } })
      .then((r) => r.data),
  // Create a budget by dimension (BUDGET_MANAGE). amountTotal is a decimal string.
  create: (input: BudgetCreateInput) =>
    api.post<BudgetSummary>('/budgets', input).then((r) => r.data),
  // Edit name/policy/status (BUDGET_MANAGE). amountTotal is never editable (invariant 3).
  update: (id: string, input: BudgetUpdateInput) =>
    api.patch<BudgetSummary>(`/budgets/${id}`, input).then((r) => r.data),
  // Creates an approvable adjustment document; returns its id so the caller can route
  // to it. The balance only changes once that document is fully approved.
  createAdjustment: (id: string, input: CreateAdjustmentInput) =>
    api.post<{ documentId: string }>(`/budgets/${id}/adjustments`, input).then((r) => r.data),
  // Creates an approvable transfer document; returns its id. The paired TRANSFER_OUT/IN
  // is written only once that document is fully approved.
  // Propose budgets for approval. Creating a budget only drafts it; this is what asks for the
  // signature that puts it in force. Returns the plan document's id so the caller can route to it.
  createPlan: (input: { departmentId: string; lines: Array<{ budgetId: string; reason?: string }> }) =>
    api.post<{ documentId: string }>('/budgets/plans', input).then((r) => r.data),
  // The plan that proposed a budget, or null — so a DRAFT budget's detail can say why nothing can
  // be spent against it.
  planForBudget: (budgetId: string) =>
    api.get<{ id: string; docNo: string; status: string } | null>(`/budgets/${budgetId}/plan`).then((r) => r.data),
  createTransfer: (input: BudgetTransferInput & { documentTypeId?: string }) =>
    api.post<{ documentId: string }>('/budgets/transfers', input).then((r) => r.data),
  // Movement document types (grouped by operation) the user may pick from; BUDGET_MANAGE.
  movementDocTypes: () =>
    api.get<MovementDocTypes>('/budgets/movement-doc-types').then((r) => r.data),
};
