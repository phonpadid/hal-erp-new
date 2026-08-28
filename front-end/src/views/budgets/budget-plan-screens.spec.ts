import PrimeVue from 'primevue/config';
import ConfirmationService from 'primevue/confirmationservice';
import ToastService from 'primevue/toastservice';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { can } from '../../directives/can';
import { useAuthStore } from '../../stores/auth';

/**
 * The screens for a budget that is not in force yet.
 *
 * A budget is now DRAFT until the plan proposing it is approved, and DRAFT budgets are governed by
 * nothing on purpose. Two things follow, and neither is visible to a type check: the list must not
 * file them under "no control point governs these" (which is the red configuration-fault heading),
 * and the detail must not offer Adjust or Transfer on a budget that has no money to move.
 */
const CURRENCY = { company: { baseCurrency: { code: 'LAK', decimalPlaces: 0 } } };

const NODES = [
  { id: 'n-1', code: '1', name: 'General admin', fiscalYearId: 'fy1', budgetCount: 0, childCount: 1 },
  { id: 'n-101', code: '1.101', name: 'Office supplies', parentId: 'n-1', fiscalYearId: 'fy1', budgetCount: 1, childCount: 0 },
  // Next year's plan, same numbering. Offering it in this year's form would attach this year's
  // money to last year's line.
  { id: 'n-101-next', code: '1.101', name: 'Office supplies', fiscalYearId: 'fy2', budgetCount: 0, childCount: 0 },
];

const ACTIVE_BUDGET = {
  id: 'b-1', node: { id: 'n-101', code: '1.101', name: 'Office supplies' }, glAccount: '1.101', budgetName: 'Office supplies',
  amountTotal: '350000000', status: 'ACTIVE', available: '50000000', fiscalYear: CURRENCY,
};
const DRAFT_BUDGET = {
  id: 'b-2', node: { id: 'n-102', code: '1.102' }, glAccount: '1.102', budgetName: 'Proposed stationery',
  amountTotal: '10000000', status: 'DRAFT', available: '10000000', fiscalYear: CURRENCY,
};
const CP = {
  id: 'cp-1', fiscalYearId: 'fy1',
  budgetNodeId: 'a1', budgetNodeCode: '1.100', budgetNodeName: 'General admin',
  departmentNodeId: 'd1', departmentNodeCode: 'ADMIN', departmentNodeName: 'Administration',
  capAmount: null, tolerance: [{ at: 100, action: 'BLOCK' as const }], isActive: true,
  ceiling: '350000000', used: '300000000', available: '50000000',
  governedBudgetIds: ['b-1'],
};

const createMock = vi.fn();
const createNodeMock = vi.fn();
const createPlanMock = vi.fn();
const proposeMock = vi.fn();
const reproposeMock = vi.fn();
const planForBudgetMock = vi.fn();
const getMock = vi.fn();

vi.mock('../../api/budgets', async (orig) => {
  const actual = (await orig()) as { budgetsApi: Record<string, unknown> };
  return {
    ...actual,
    budgetsApi: {
      ...actual.budgetsApi,
      list: vi.fn().mockResolvedValue({
        items: [ACTIVE_BUDGET, DRAFT_BUDGET], total: 2, page: 1, limit: 20,
      }),
      controlPointList: vi.fn().mockResolvedValue([CP]),
      get: (...a: unknown[]) => getMock(...a),
      breakdown: vi.fn().mockResolvedValue({
        amountTotal: '10000000', adjustIncrease: '0', adjustDecrease: '0',
        transferIn: '0', transferOut: '0', reserve: '0', release: '0',
        actual: '0', available: '10000000',
      }),
      controlPoints: vi.fn().mockResolvedValue([]),
      ledger: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 }),
      movementDocTypes: vi.fn().mockResolvedValue({ adjustIncrease: [], adjustDecrease: [], transfer: [] }),
      nodes: vi.fn().mockResolvedValue(NODES),
      // The form reads its fiscal years and departments through BUDGET-scoped endpoints now. It
      // used to read them from the organisation directory, which demands `FISCAL_YEAR_MANAGE` and
      // `DEPARTMENT_VIEW` — permissions a budget officer has no reason to hold.
      selectableFiscalYears: vi.fn().mockResolvedValue([
        { id: 'fy1', year: 2026, status: 'OPEN', startDate: '2026-01-01', endDate: '2026-12-31' },
        { id: 'fy2', year: 2027, status: 'OPEN', startDate: '2027-01-01', endDate: '2027-12-31' },
      ]),
      selectableDepartments: vi.fn().mockResolvedValue([
        { id: 'd1', deptCode: 'ADM', name: 'Administration' },
      ]),
      createNode: (...a: unknown[]) => createNodeMock(...a),
      create: (...a: unknown[]) => createMock(...a),
      createPlan: (...a: unknown[]) => createPlanMock(...a),
      propose: (...a: unknown[]) => proposeMock(...a),
      repropose: (...a: unknown[]) => reproposeMock(...a),
      planForBudget: (...a: unknown[]) => planForBudgetMock(...a),
    },
  };
});

// The chart-of-accounts read behind the GL hint. Unmocked it hangs on a request that never
// resolves in jsdom, and the form stays in its loading state forever.
vi.mock('../../api/accounts', () => ({
  accountsApi: {
    selectable: vi.fn().mockResolvedValue([{ id: 'a1', code: '5000', name: 'Office supplies' }]),
  },
}));

// The org reads the create form makes on mount. Unmocked they reject, and the form never leaves
// its loading state — which is why the assertions below could otherwise pass against a blank page.
vi.mock('../../api/org', () => ({
  orgApi: {
    fiscalYears: { list: vi.fn().mockResolvedValue({ items: [{ id: 'fy1', year: 2026 }, { id: 'fy2', year: 2027 }], total: 2, page: 1, limit: 100 }) },
    departments: { list: vi.fn().mockResolvedValue({ items: [{ id: 'd1', name: 'Administration' }], total: 1, page: 1, limit: 100 }) },
    companies: { list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 100 }) },
  },
}));

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/budgets', name: 'budgets', component: { template: '<div />' } },
      { path: '/budgets/new', name: 'budget-new', component: { template: '<div />' } },
      { path: '/budgets/:id/edit', name: 'budget-edit', component: { template: '<div />' } },
      { path: '/budgets/control-points/:id', name: 'control-point-detail', component: { template: '<div />' } },
      { path: '/documents/:id', name: 'document-detail', component: { template: '<div />' } },
      { path: '/budgets/:id', name: 'budget-detail', component: { template: '<div />' } },
    ],
  });
}

async function mountView(path: string, file: string, permissions: string[]) {
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().permissions = permissions;
  const router = makeRouter();
  router.push(path);
  await router.isReady();
  const { default: View } = await import(/* @vite-ignore */ file);
  const w = mount(View, {
    global: {
      plugins: [i18n, PrimeVue, ToastService, ConfirmationService, router, pinia],
      directives: { can },
      stubs: { teleport: true },
    },
  });
  await flushPromises();
  return { w, router };
}

describe('budgets that are not in force', () => {
  beforeEach(() => {
    createMock.mockReset();
    createPlanMock.mockReset();
    proposeMock.mockReset();
    reproposeMock.mockReset();
    planForBudgetMock.mockReset();
    getMock.mockReset();
  });

  describe('the list', () => {
    it('groups a DRAFT budget under its status, not under the configuration fault', async () => {
      const { w } = await mountView('/budgets', './BudgetListView.vue', ['BUDGET_VIEW']);
      const text = w.text();
      // Its own heading...
      expect(text).toContain(i18n.global.t('budgets.status.DRAFT'));
      expect(text).toContain(i18n.global.t('budgets.groups.notInForceHint'));
      // ...and NOT the red "no control point governs these" fault heading, which would report a
      // defect where the system is working as specified.
      expect(text).not.toContain(i18n.global.t('budgets.groups.ungoverned'));
    });

    it('gives the not-in-force group no ceiling or available figure', async () => {
      // No control point governs these and none is owed, so any figure here would be invented.
      const { w } = await mountView('/budgets', './BudgetListView.vue', ['BUDGET_VIEW']);
      const headers = w.findAll('tr.p-datatable-row-group-header');
      const pending = headers.find((h) => h.text().includes(i18n.global.t('budgets.groups.notInForceHint')));
      expect(pending).toBeDefined();
      expect(pending!.text()).not.toContain('%');
    });

    it('still shows the fault heading for an ACTIVE budget nothing governs', async () => {
      // The two must not collapse into one another: this one IS a defect.
      const pinia = createPinia();
      setActivePinia(pinia);
      const { useBudgetsStore } = await import('../../stores/budgets');
      const store = useBudgetsStore();
      store.list = [{ ...ACTIVE_BUDGET, id: 'b-orphan' } as never];
      store.controlPointList = [];
      const groups = store.groupedBudgets;
      expect(groups).toHaveLength(1);
      expect(groups[0].ungoverned).toBe(true);
    });
  });

  describe('the detail', () => {
    it('offers neither Adjust nor Transfer, and names the plan that proposed it', async () => {
      getMock.mockResolvedValue({ ...DRAFT_BUDGET, department: { name: 'ADMIN' } });
      planForBudgetMock.mockResolvedValue({ id: 'doc-9', docNo: 'PLAN-0001', status: 'SUBMITTED' });

      const { w } = await mountView('/budgets/b-2', './BudgetDetailView.vue', ['BUDGET_VIEW', 'BUDGET_MANAGE']);
      const text = w.text();
      expect(text).toContain('PLAN-0001');
      expect(text).toContain(i18n.global.t('budgets.plan.notInForce'));
      expect(text).not.toContain(i18n.global.t('budgets.adjust.button'));
      expect(text).not.toContain(i18n.global.t('budgets.transfer.button'));
    });

    it('offers them again once the budget is in force', async () => {
      getMock.mockResolvedValue({ ...ACTIVE_BUDGET, department: { name: 'ADMIN' } });

      const { w } = await mountView('/budgets/b-1', './BudgetDetailView.vue', ['BUDGET_VIEW', 'BUDGET_MANAGE']);
      const text = w.text();
      expect(text).toContain(i18n.global.t('budgets.adjust.button'));
      expect(text).toContain(i18n.global.t('budgets.transfer.button'));
      // An ACTIVE budget's plan is history — the ledger says where its money went.
      expect(planForBudgetMock).not.toHaveBeenCalled();
    });
  });

  describe('the create form', () => {
    it('says saving proposes rather than sets', async () => {
      const { w } = await mountView('/budgets/new', './BudgetFormView.vue', ['BUDGET_VIEW', 'BUDGET_MANAGE']);
      expect(w.text()).toContain(i18n.global.t('budgets.plan.proposeNotice'));
    });

    it('asks for the plan node, and says the account does not identify the budget', async () => {
      // 7.1: the node is the identity. The account is a hint, and the form has to say so — a user
      // who reads the account as the identity will look for one budget per account and not find it.
      const { w } = await mountView('/budgets/new', './BudgetFormView.vue', ['BUDGET_VIEW', 'BUDGET_MANAGE']);
      const text = w.text();
      expect(text).toContain(i18n.global.t('budgets.form.node'));
      expect(text).toContain(i18n.global.t('budgets.form.nodeHint'));
      expect(text).toContain(i18n.global.t('budgets.form.glAccountHint'));
    });

    it('offers only the chosen fiscal year’s nodes', async () => {
      // A plan is rewritten each year and keeps its numbering, so `1.101` exists once per year.
      // Offering last year's would attach this year's money to it, and nothing would say so.
      const { w } = await mountView('/budgets/new', './BudgetFormView.vue', ['BUDGET_VIEW', 'BUDGET_MANAGE']);
      const nodeSelect = w
        .findAllComponents({ name: 'Select' })
        .find((sel) => sel.props('placeholder') === i18n.global.t('budgets.form.nodePlaceholder'));
      expect(nodeSelect).toBeDefined();
      // No fiscal year chosen yet — every node is offered, and the year narrows it.
      expect((nodeSelect!.props('options') as Array<{ value: string }>).map((o) => o.value))
        .toEqual(['n-1', 'n-101', 'n-101-next']);

      // Set it the way the form itself does, so the assertion follows the form's own state rather
      // than a value only this test knows about.
      const form = w.findComponent({ name: 'Form' });
      (form.vm as unknown as { setFieldValue: (f: string, v: unknown) => void }).setFieldValue('fiscalYearId', 'fy1');
      await flushPromises();
      expect((nodeSelect!.props('options') as Array<{ value: string }>).map((o) => o.value))
        .toEqual(['n-1', 'n-101']);
    });

    it('shows the node read-only when editing, because history refers to the budget by it', async () => {
      getMock.mockResolvedValue(ACTIVE_BUDGET);
      const { w } = await mountView('/budgets/b-1/edit', './BudgetFormView.vue', ['BUDGET_VIEW', 'BUDGET_MANAGE']);
      expect(w.text()).toContain(i18n.global.t('budgets.form.nodeReadonlyHint'));
      // The picker itself is not offered — only the locked display.
      const selects = w.findAllComponents({ name: 'Select' });
      expect(selects.every((sel) => !(sel.props('placeholder') === i18n.global.t('budgets.form.nodePlaceholder')))).toBe(true);
    });

    it('proposes in ONE call and routes to the plan', async () => {
      // This used to assert the two-call sequence: `create`, then `createPlan` with the new id.
      // That sequence is the defect. A failure between the two committed the budget and not the
      // plan, and the resulting DRAFT could not be spent, deleted, or proposed again — the
      // dimension index refuses a second row and no screen could raise a plan for an existing one.
      // Budget `1.106` sat in that state on the customer's database.
      const pinia = createPinia();
      setActivePinia(pinia);
      const { useBudgetsStore } = await import('../../stores/budgets');
      proposeMock.mockResolvedValue({ budgetId: 'b-new', documentId: 'doc-new' });

      const input = { fiscalYearId: 'fy1', departmentId: 'd1', glAccount: '5000', amountTotal: '1000' };
      const result = await useBudgetsStore().proposeBudget(input as never);

      expect(proposeMock).toHaveBeenCalledOnce();
      expect(proposeMock).toHaveBeenCalledWith(input);
      // The client no longer sequences two writes and hopes.
      expect(createMock).not.toHaveBeenCalled();
      expect(createPlanMock).not.toHaveBeenCalled();
      expect(result.documentId).toBe('doc-new');
    });

    it('leaves no budget behind when the one call fails', async () => {
      const pinia = createPinia();
      setActivePinia(pinia);
      const { useBudgetsStore } = await import('../../stores/budgets');
      proposeMock.mockRejectedValue(new Error('no ACTIVATE_BUDGET type is configured'));

      await expect(
        useBudgetsStore().proposeBudget({ fiscalYearId: 'fy1', departmentId: 'd1', amountTotal: '1000' } as never),
      ).rejects.toThrow();

      // Nothing the client could have half-written: there was only ever one write to make.
      expect(createMock).not.toHaveBeenCalled();
    });

    it('re-proposes a stranded draft through the store', async () => {
      const pinia = createPinia();
      setActivePinia(pinia);
      const { useBudgetsStore } = await import('../../stores/budgets');
      reproposeMock.mockResolvedValue({ documentId: 'doc-rescued' });

      const result = await useBudgetsStore().reproposeBudget('b-stranded');

      expect(reproposeMock).toHaveBeenCalledWith('b-stranded');
      expect(result.documentId).toBe('doc-rescued');
    });
  });
});
