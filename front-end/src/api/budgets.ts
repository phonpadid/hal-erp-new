import { api } from './client';
import type { Paginated } from './pagination';
import type { BudgetCreateInput, BudgetTransferInput, BudgetUpdateInput } from '@erp/shared';

export interface CurrencyRef {
  code?: string;
  decimalPlaces?: number;
}

export interface BudgetSummary {
  id: string;
  glAccount: string;
  budgetName?: string;
  amountTotal: string;
  status: string;
  /** Derived available balance, computed server-side per row (see BudgetService.list). */
  available?: string;
  fiscalYear?: { year?: number; company?: { baseCurrency?: CurrencyRef | null } };
  department?: { name?: string };
}

/** Minimal budget shape for the Create Document per-line picker — no amounts (DOC_CREATE read). */
export interface SelectableBudget {
  id: string;
  budgetName?: string;
  glAccount: string;
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
}

/** Budget views plus BUDGET_MANAGE affordances (create/edit, transfer, adjustment). */
export const budgetsApi = {
  list: (page = 1, limit = 20) =>
    api.get<Paginated<BudgetSummary>>('/budgets', { params: { page, limit } }).then((r) => r.data),
  // Budget picker for document creation — gated by DOC_CREATE (not BUDGET_VIEW); returns no
  // amounts. Used by the Create Document wizard to let a requester charge a line to a budget.
  selectable: () =>
    api.get<SelectableBudget[]>('/budgets/selectable').then((r) => r.data),
  get: (id: string) => api.get(`/budgets/${id}`).then((r) => r.data),
  breakdown: (id: string) => api.get<BalanceBreakdown>(`/budgets/${id}/breakdown`).then((r) => r.data),
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
  createTransfer: (input: BudgetTransferInput) =>
    api.post<{ documentId: string }>('/budgets/transfers', input).then((r) => r.data),
};
