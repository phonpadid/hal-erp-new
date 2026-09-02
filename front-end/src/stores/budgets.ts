import { defineStore } from 'pinia';
import type { BudgetCreateInput, BudgetTransferInput, BudgetUpdateInput } from '@erp/shared';
import { budgetsApi } from '../api/budgets';
import type {
  BalanceBreakdown,
  BudgetNodeView,
  BudgetSummary,
  FilterDepartment,
  ControlPointBalance,
  ControlPointSummary,
  GoverningControlPoint,
  LedgerEntry,
} from '../api/budgets';
import { messageOf } from '../utils/apiError';
import { sumAmounts } from '../utils/money';

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

/** How the budget list is presented. See {@link BudgetsState.listMode}. */
export type BudgetListMode = 'points' | 'tree' | 'flat';

/**
 * The tree is not paginated, so it asks for a page big enough to hold a company's plan. A subtree
 * total summed over one page of its budgets would be a wrong figure shown as a right one.
 */
const TREE_PAGE_SIZE = 500;

/** One row of the tree presentation: a plan node with a total, or a budget with its own money. */
export interface BudgetTreeNode {
  key: string;
  data: {
    kind: 'node' | 'budget';
    id: string;
    code: string;
    name: string;
    /** For a node this is the SUM of the budgets beneath it, never an allocation of its own. */
    amountTotal: string;
    available: string;
    status?: string;
    budget?: BudgetSummary & { available?: string };
  };
  children?: BudgetTreeNode[];
}

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
   * How the budget list is presented. Session-scoped on purpose: it stops the list re-grouping on
   * every visit for someone scanning by name, without becoming a stored user preference — that
   * needs server-side storage and its own permissions, and is a different feature.
   *
   * `points` groups by the control point that governs each budget — the ceiling that decides what
   * can be spent. `tree` follows the PLAN instead: department, category, line, which is the shape
   * the budget was written in and the one a department head checks against their own book. They
   * answer different questions and neither replaces the other.
   */
  listMode: BudgetListMode;
  /** The plan's structure, loaded for the tree presentation only. */
  nodes: BudgetNodeView[];
  ledger: LedgerEntry[];
  ledgerTotal: number;
  ledgerPage: number;
  ledgerLimit: number;
  ledgerLoading: boolean;
  /**
   * What the reader asked to see. Kept in the store rather than passed per call so paging keeps
   * it: page 2 of a narrowed list is page 2 of that same narrowing.
   */
  search: string;
  departmentId: string;
  status: string;
  /** Options for the department filter — only departments that hold a budget. */
  filterDepartments: FilterDepartment[];
  /**
   * How many budgets exist with nothing narrowed, so the screen can say what a filter is hiding.
   *
   * Refreshed on every load that has no narrowing active, which includes the first. A filter can
   * be set and then scrolled past, and a narrowed list that does not say it is narrowed cannot be
   * told from a complete one.
   */
  totalUnfiltered: number;
  loading: boolean;
  error: string;
}


export const useBudgetsStore = defineStore('budgets', {
  state: (): BudgetsState => ({ list: [], total: 0, page: 1, limit: 20, current: null, breakdown: null, controlPoints: [], controlPointList: [], currentControlPoint: null, controlPointBalance: null, controlPointsLoading: false, currentPlan: null, listMode: 'points', nodes: [], ledger: [], ledgerTotal: 0, ledgerPage: 1, ledgerLimit: 20, ledgerLoading: false, search: '', departmentId: '', status: '', filterDepartments: [], totalUnfiltered: 0, loading: false, error: '' }),
  actions: {
    /**
     * Narrow the list, and go back to page 1.
     *
     * Back to page 1 because the narrowing changes which budgets exist: page 12 of 25 means
     * nothing once the set is 59 rows, and landing on an empty page reads as "no results" when
     * the results are simply earlier.
     */
    async narrow(next: { search?: string; departmentId?: string; status?: string }) {
      if (next.search !== undefined) this.search = next.search;
      if (next.departmentId !== undefined) this.departmentId = next.departmentId;
      if (next.status !== undefined) this.status = next.status;
      await this.loadList(1, this.limit);
    },

    /** Clear everything narrowing the list, and reload it whole. */
    async clearNarrowing() {
      this.search = '';
      this.departmentId = '';
      this.status = '';
      await this.loadList(1, this.limit);
    },

    /**
     * The department filter's options. Loaded once per company context, not per keystroke or per
     * page: the set changes only when a budget is created in a department that had none.
     */
    async loadFilterDepartments() {
      try {
        this.filterDepartments = await budgetsApi.filterDepartments();
      } catch {
        // Deliberately NOT `this.error`. That field is what the screen renders an ErrorState for
        // INSTEAD of the table, so writing it here would let a failed dropdown take down a list
        // that loaded perfectly well — which is exactly what it did until an existing spec caught
        // it. A filter whose options are missing is a filter that cannot be used; the list is
        // still readable and still pages, and the empty control says as much on its own.
        this.filterDepartments = [];
      }
    },

    async loadList(page?: number, limit?: number, search?: string) {
      this.loading = true;
      this.error = '';
      if (search !== undefined) this.search = search;
      try {
        const res = await budgetsApi.list(page ?? this.page, limit ?? this.limit, {
          search: this.search || undefined,
          departmentId: this.departmentId || undefined,
          status: this.status || undefined,
        });
        this.page = res.page;
        this.limit = res.limit;
        this.total = res.total;
        // With nothing narrowed, this total IS the unnarrowed one — so the count the screen shows
        // beside a filter stays honest without a second request asking how many there are.
        if (!this.narrowing) this.totalUnfiltered = res.total;
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

    setListMode(mode: BudgetListMode) {
      this.listMode = mode;
    },

    /** Kept for the two-state callers: grouped means grouped by control point. */
    setListGrouped(grouped: boolean) {
      this.listMode = grouped ? 'points' : 'flat';
    },

    /**
     * The plan's structure, and every budget in it.
     *
     * The tree is deliberately NOT paginated. A category's figure is the sum of the budgets beneath
     * it, and a sum taken over one page of them is a wrong number presented as a right one — worse
     * than a long list. The page size is raised for the duration instead.
     */
    async loadTree(fiscalYearId?: string) {
      this.loading = true;
      this.error = '';
      try {
        const [nodes] = await Promise.all([budgetsApi.nodes(fiscalYearId), this.loadList(1, TREE_PAGE_SIZE)]);
        this.nodes = nodes;
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
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
    /** True when anything is narrowing the list — a term or either filter. */
    narrowing(state): boolean {
      return Boolean(state.search || state.departmentId || state.status);
    },

    /** Grouped by control point — the two-state callers' view of {@link BudgetsState.listMode}. */
    listGrouped(state): boolean {
      return state.listMode === 'points';
    },

    /**
     * The budgets arranged under the plan they were written in.
     *
     * A node row is STRUCTURE: it holds no money of its own, and its figure is the sum of the
     * budgets in its subtree. That is why `kind` is on every row — a screen that could not tell
     * the two apart would render a category as though someone had allocated that amount to it.
     *
     * Nodes with nothing beneath them are kept: an empty category is a plan being written, not a
     * fault, and dropping it would hide the structure the user is in the middle of building.
     */
    budgetTree(state): BudgetTreeNode[] {
      const byNode = new Map<string, Array<BudgetSummary & { available?: string }>>();
      for (const b of state.list) {
        const nodeId = typeof b.node === 'string' ? b.node : b.node?.id;
        if (!nodeId) continue;
        const arr = byNode.get(nodeId);
        if (arr) arr.push(b);
        else byNode.set(nodeId, [b]);
      }

      const childrenOf = new Map<string | undefined, BudgetNodeView[]>();
      for (const n of state.nodes) {
        const arr = childrenOf.get(n.parentId);
        if (arr) arr.push(n);
        else childrenOf.set(n.parentId, [n]);
      }

      // Money stays a string end to end: summed with Decimal, never with `+`.
      const sum = (a: string, b: string) => sumAmounts([a, b]);

      const build = (n: BudgetNodeView): BudgetTreeNode => {
        const kids = (childrenOf.get(n.id) ?? [])
          .slice()
          .sort((x, y) => x.code.localeCompare(y.code))
          .map(build);
        const own = (byNode.get(n.id) ?? []).map<BudgetTreeNode>((b) => ({
          key: `b:${b.id}`,
          data: {
            kind: 'budget',
            id: b.id,
            code: typeof b.node === 'string' ? '' : (b.node?.code ?? ''),
            name: b.budgetName ?? '',
            amountTotal: b.amountTotal,
            available: b.available ?? b.amountTotal,
            status: b.status,
            budget: b,
          },
        }));
        // A node holding exactly one budget and no child nodes IS that budget to a reader: the
        // plan line and the money at it are the same row in their book. Rendering both put the
        // same figure on screen twice, the outer one marked Σ as though something were being
        // summed. Caught on the running app, not by a test — the tree was correct and unreadable.
        if (!kids.length && own.length === 1) {
          const only = own[0];
          return { ...only, key: `n:${n.id}`, data: { ...only.data, code: n.code, name: only.data.name || (n.name ?? '') } };
        }
        const children = [...kids, ...own];
        let amountTotal = '0';
        let available = '0';
        for (const c of children) {
          amountTotal = sum(amountTotal, c.data.amountTotal);
          available = sum(available, c.data.available);
        }
        return {
          key: `n:${n.id}`,
          data: { kind: 'node', id: n.id, code: n.code, name: n.name ?? '', amountTotal, available },
          children,
        };
      };

      const roots = (childrenOf.get(undefined) ?? [])
        .slice()
        .sort((a, b) => a.code.localeCompare(b.code))
        .map(build);

      // A budget whose node was not loaded still has to appear — a list that silently drops rows is
      // worse than one that shows them at the root.
      const placed = new Set(state.nodes.map((n) => n.id));
      const orphans = state.list
        .filter((b) => {
          const nodeId = typeof b.node === 'string' ? b.node : b.node?.id;
          return !nodeId || !placed.has(nodeId);
        })
        .map<BudgetTreeNode>((b) => ({
          key: `b:${b.id}`,
          data: {
            kind: 'budget',
            id: b.id,
            code: typeof b.node === 'string' ? '' : (b.node?.code ?? ''),
            name: b.budgetName ?? '',
            amountTotal: b.amountTotal,
            available: b.available ?? b.amountTotal,
            status: b.status,
            budget: b,
          },
        }));
      return [...roots, ...orphans];
    },

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
      if (state.listMode !== 'points') {
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
      // One bucket per non-ACTIVE status, keyed by the status value rather than by a list of known
      // ones — so a status added later is bucketed correctly instead of falling into the fault
      // bucket by omission.
      //
      // Each is ungoverned for a reason of its own and none is a defect: DRAFT and REJECTED have
      // never had coverage, because it is established at activation; CLOSED had it and no longer
      // needs it, because a ceiling on an appropriation nobody can draw from governs nothing.
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
