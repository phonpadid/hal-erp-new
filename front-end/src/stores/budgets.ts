import { defineStore } from 'pinia';
import type { BudgetCreateInput, BudgetTransferInput, BudgetUpdateInput } from '@erp/shared';
import { budgetsApi } from '../api/budgets';
import type {
  BalanceBreakdown,
  BudgetSummary,
  ControlPointBalance,
  ControlPointSummary,
  GoverningControlPoint,
  LedgerEntry,
} from '../api/budgets';
import { messageOf } from '../utils/apiError';

/** Key of the bucket holding budgets no control point governs — a configuration fault, not a group. */
export const UNGOVERNED_GROUP = '__ungoverned__';

/** Key of the single bucket used when the list is flat — it renders no header. */
export const FLAT_GROUP = '__flat__';

/**
 * Key prefix for a bucket of budgets that are not in force — the status is appended, so DRAFT and
 * REJECTED get a bucket each. Distinct from UNGOVERNED_GROUP on purpose: an ACTIVE budget nothing
 * governs is a configuration fault, while a DRAFT one nothing governs is simply a budget waiting
 * for its plan to be approved.
 */
export const PENDING_GROUP = '__pending__';

/** One group in the budget list: a control point and the budgets it is the binding ceiling for. */
export interface BudgetGroup {
  key: string;
  /** null only for the ungoverned bucket. */
  controlPoint: ControlPointSummary | null;
  budgets: Array<BudgetSummary & { available?: string }>;
  ungoverned: boolean;
  /** Set only on a not-in-force bucket, naming the status its budgets share. */
  budgetStatus?: string;
}

interface BudgetsState {
  list: Array<BudgetSummary & { available?: string }>;
  total: number;
  page: number;
  limit: number;
  current: any | null;
  breakdown: BalanceBreakdown | null;
  /** Control points governing the current budget — the ceilings that actually gate a submit. */
  controlPoints: GoverningControlPoint[];
  /** Every control point in the company for the chosen fiscal year — drives the list screen and
   *  the budget-list grouping. */
  controlPointList: ControlPointSummary[];
  /** The control point currently open on its detail screen. */
  currentControlPoint: ControlPointSummary | null;
  controlPointBalance: ControlPointBalance | null;
  controlPointsLoading: boolean;
  /** The plan that proposed the open budget — only a non-ACTIVE budget's screen shows it. */
  currentPlan: { id: string; docNo: string; status: string } | null;
  /**
   * Grouped or flat budget list. Session-scoped on purpose: it stops the list re-grouping on every
   * visit for someone scanning by name, without becoming a stored user preference — that needs
   * server-side storage and its own permissions, and is a different feature.
   */
  listGrouped: boolean;
  ledger: LedgerEntry[];
  ledgerTotal: number;
  ledgerPage: number;
  ledgerLimit: number;
  ledgerLoading: boolean;
  loading: boolean;
  error: string;
}


export const useBudgetsStore = defineStore('budgets', {
  state: (): BudgetsState => ({ list: [], total: 0, page: 1, limit: 20, current: null, breakdown: null, controlPoints: [], controlPointList: [], currentControlPoint: null, controlPointBalance: null, controlPointsLoading: false, currentPlan: null, listGrouped: true, ledger: [], ledgerTotal: 0, ledgerPage: 1, ledgerLimit: 20, ledgerLoading: false, loading: false, error: '' }),
  actions: {
    async loadList(page?: number, limit?: number) {
      this.loading = true;
      this.error = '';
      try {
        const res = await budgetsApi.list(page ?? this.page, limit ?? this.limit);
        this.page = res.page;
        this.limit = res.limit;
        this.total = res.total;
        // `available` is now computed server-side per row (one batched pass), so the list
        // renders without the old per-row breakdown fetch (N+1).
        this.list = res.items;
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    async loadOne(id: string) {
      this.loading = true;
      this.error = '';
      try {
        // Header, derived breakdown and the first ledger page are independent — fetch together.
        const [current, breakdown, controlPoints] = await Promise.all([
          budgetsApi.get(id),
          budgetsApi.breakdown(id),
          budgetsApi.controlPoints(id),
          this.loadLedger(id, 1),
        ]);
        this.current = current;
        this.breakdown = breakdown;
        this.controlPoints = controlPoints;
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    // Paged, newest-first ledger. Called for page 1 by loadOne; the detail view
    // re-invokes it on paginator page changes (server-side paging).
    async loadLedger(id: string, page?: number, limit?: number) {
      this.ledgerLoading = true;
      try {
        const res = await budgetsApi.ledger(id, page ?? this.ledgerPage, limit ?? this.ledgerLimit);
        this.ledger = res.items;
        this.ledgerTotal = res.total;
        this.ledgerPage = res.page;
        this.ledgerLimit = res.limit;
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.ledgerLoading = false;
      }
    },

    setListGrouped(grouped: boolean) {
      this.listGrouped = grouped;
    },

    /**
     * Control points for a fiscal year. Also the second half of the budget list: `groupedBudgets`
     * joins the loaded budgets to these, so the list screen loads both.
     */
    async loadControlPoints(fiscalYearId?: string) {
      this.controlPointsLoading = true;
      this.error = '';
      try {
        this.controlPointList = await budgetsApi.controlPointList(fiscalYearId);
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.controlPointsLoading = false;
      }
    },

    /** One control point's detail: its row from the list plus the derived breakdown. */
    async loadControlPoint(id: string, fiscalYearId?: string) {
      this.loading = true;
      this.error = '';
      try {
        if (!this.controlPointList.length) await this.loadControlPoints(fiscalYearId);
        const [balance] = await Promise.all([
          budgetsApi.controlPointBalance(id),
          this.list.length ? Promise.resolve() : this.loadList(),
        ]);
        this.currentControlPoint = this.controlPointList.find((c) => c.id === id) ?? null;
        this.controlPointBalance = balance;
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    // BUDGET_MANAGE affordances. These rethrow so the caller can route on success and
    // surface server errors; this.error mirrors the message for inline display.
    async createBudget(input: BudgetCreateInput): Promise<BudgetSummary> {
      this.error = '';
      try {
        return await budgetsApi.create(input);
      } catch (e) {
        this.error = messageOf(e);
        throw e;
      }
    },

    /**
     * Propose a budget: draft it, then create the plan that asks for approval to put it in force.
     *
     * Two calls because they are two resources — the budget exists as a DRAFT row the moment the
     * first succeeds, and it stays visible in the list under its status, so a failure of the second
     * leaves something the user can see and act on rather than a silent gap.
     */
    async proposeBudget(input: BudgetCreateInput): Promise<{ budget: BudgetSummary; documentId: string }> {
      this.error = '';
      try {
        const budget = await budgetsApi.create(input);
        const { documentId } = await budgetsApi.createPlan({
          departmentId: input.departmentId,
          lines: [{ budgetId: budget.id }],
        });
        return { budget, documentId };
      } catch (e) {
        this.error = messageOf(e);
        throw e;
      }
    },

    /** The plan that proposed the current budget, or null. */
    async loadPlanForBudget(budgetId: string) {
      try {
        this.currentPlan = await budgetsApi.planForBudget(budgetId);
      } catch (e) {
        this.error = messageOf(e);
      }
    },

    async updateBudget(id: string, input: BudgetUpdateInput): Promise<BudgetSummary> {
      this.error = '';
      try {
        return await budgetsApi.update(id, input);
      } catch (e) {
        this.error = messageOf(e);
        throw e;
      }
    },

    // Creates the approvable transfer document; returns its id so the caller can route
    // to it. Balances do not change until that document is fully approved.
    async createTransfer(input: BudgetTransferInput & { documentTypeId?: string }): Promise<{ documentId: string }> {
      this.error = '';
      try {
        return await budgetsApi.createTransfer(input);
      } catch (e) {
        this.error = messageOf(e);
        throw e;
      }
    },
  },

  getters: {
    /**
     * The budget list grouped by the control point that governs each budget.
     *
     * A budget may be governed by several points; it appears ONCE, under the one with the least
     * available — the ceiling that will refuse it first, and so the only one whose number changes
     * what the user can do next. Ties break on control point id so the list does not reshuffle
     * between loads.
     *
     * Group figures come from the control point itself and are never summed here: a point's
     * available covers its whole governed set, including budgets outside the current page, so a
     * browser-side sum would be wrong as well as forbidden by the money rule.
     */
    groupedBudgets(state): BudgetGroup[] {
      // Flat mode renders the SAME loaded rows with no headers — one bucket, no refetch, no paging
      // change. Keeping it a presentation choice is what makes the two modes provably agree.
      if (!state.listGrouped) {
        return state.list.length
          ? [{ key: FLAT_GROUP, controlPoint: null, budgets: [...state.list], ungoverned: false }]
          : [];
      }
      const pointsByBudget = new Map<string, ControlPointSummary[]>();
      for (const cp of state.controlPointList) {
        for (const budgetId of cp.governedBudgetIds) {
          const arr = pointsByBudget.get(budgetId);
          if (arr) arr.push(cp);
          else pointsByBudget.set(budgetId, [cp]);
        }
      }

      const groups = new Map<string, BudgetGroup>();
      const ungoverned: BudgetGroup = {
        key: UNGOVERNED_GROUP,
        controlPoint: null,
        budgets: [],
        ungoverned: true,
      };
      // One bucket per non-ACTIVE status. These are ungoverned BY DESIGN — coverage is established
      // when the plan proposing them is approved — so putting them in the fault bucket would
      // report a defect where the system is working as specified.
      const pending = new Map<string, BudgetGroup>();

      for (const budget of state.list) {
        if (budget.status !== 'ACTIVE') {
          const key = `${PENDING_GROUP}${budget.status}`;
          const g = pending.get(key);
          if (g) g.budgets.push(budget);
          else pending.set(key, { key, controlPoint: null, budgets: [budget], ungoverned: false, budgetStatus: budget.status });
          continue;
        }
        const governing = pointsByBudget.get(budget.id) ?? [];
        if (!governing.length) {
          // Not "unrestricted": the coverage invariant makes this unreachable through supported
          // paths, so a row landing here is a fault worth showing rather than a budget to render
          // quietly.
          ungoverned.budgets.push(budget);
          continue;
        }
        const binding = [...governing].sort((a, b) => {
          const d = Number(a.available) - Number(b.available);
          return d !== 0 ? d : a.id.localeCompare(b.id);
        })[0];
        const g = groups.get(binding.id);
        if (g) g.budgets.push(budget);
        else groups.set(binding.id, { key: binding.id, controlPoint: binding, budgets: [budget], ungoverned: false });
      }

      // Governed groups first, then what is not in force, then the fault bucket last — the order
      // a reader wants: what is running, what is coming, what is broken.
      const out = [...groups.values(), ...pending.values()];
      if (ungoverned.budgets.length) out.push(ungoverned);
      return out;
    },
  },
});
