import { flushPromises } from '@vue/test-utils';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { VueWrapper } from '@vue/test-utils';
import { i18n } from '../../i18n';
import { mountView } from '../../test/mountView';
import DocumentDetailView from './DocumentDetailView.vue';
import ReviewApprovalDialog from '../../components/documents/ReviewApprovalDialog.vue';
import { documentsApi } from '../../api/documents';

/**
 * `BUDGET_PLAN-HAL-2026-0001` was approved for 12,000,000 LAK by a person whose screen never named
 * the budget it activates.
 *
 * Its content lives on `budget_movement`, not on `document_line`, so a detail page that renders
 * only lines said "no line items" about a document that activates twelve million kip, and the
 * approve dialog showed an amount and a type and nothing else. Every movement of money here is
 * deliberately forced through a document and an approval; that control is worth only as much as the
 * approver can see.
 *
 * Both screens are asserted, because both are where the omission bit — and both read the SAME
 * detail payload, so neither can drift into its own account of what a document does.
 */
let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});
beforeAll(() => { i18n.global.locale.value = 'en'; });
afterAll(() => { i18n.global.locale.value = 'la'; });

const PERMS = ['DOC_VIEW', 'BUDGET_VIEW'];

const ACTIVATION = {
  id: 'bm-1',
  movementType: 'ACTIVATE_BUDGET',
  amount: '12000000.00',
  fromBudget: null,
  toBudget: {
    id: 'b-106',
    code: '1.106',
    name: 'Support, subsidies and other (state)',
    department: { id: 'd-adm', deptCode: 'ADM', name: 'Administration' },
  },
};

async function openDetail(budgetMovements: unknown[], lines: unknown[] = [], permissions = PERMS) {
  const w = await mountView(DocumentDetailView, {
    path: '/documents/:id',
    routeName: 'document-detail',
    routeParams: { id: 'doc-1' },
    permissions,
    initialState: {
      documents: {
        current: { id: 'doc-1', docNo: 'BUDGET_PLAN-HAL-2026-0001', status: 'IN_APPROVAL', totalAmount: '12000000.00' },
        hasPayment: false,
        fieldValues: [], lines, budgetMovements, attachments: [], refDocument: null, approvalLog: [],
        canAct: false, sla: null, pendingApprovers: null, matching: null,
        loading: false, error: '',
      },
      auth: { permissions, baseCurrency: { code: 'LAK', decimalPlaces: 0 } },
    },
  });
  await flushPromises();
  wrapper = w;
  return w;
}

describe('the document page says what the document does to the budget', () => {
  it('names the budget by code AND name, so the figure is checkable', async () => {
    const w = await openDetail([ACTIVATION]);
    const text = w.find('[data-testid="budget-movements"]').text();

    // Neither half identifies it alone: the code is a string an approver cannot verify, and the
    // name does not match the plan they hold on paper.
    expect(text).toContain('1.106');
    expect(text).toContain('Support, subsidies and other (state)');
  });

  it('says what kind of movement it is, in words', async () => {
    const w = await openDetail([ACTIVATION]);
    expect(w.find('[data-testid="budget-movements"]').text()).toContain('Activate budget plan');
  });

  it('shows the amount in the company base currency, to its decimal places', async () => {
    const w = await openDetail([ACTIVATION]);
    // LAK has 0 decimal places, so 12000000.00 reads as 12,000,000 — not as a raw string, and
    // never through a JS number.
    expect(w.find('[data-testid="budget-movements"]').text()).toContain('12,000,000');
  });

  it('stops saying the document has no line items', async () => {
    // The complaint in one assertion. A budget plan has no lines BY DESIGN; the empty-lines card
    // beneath its movements is what made it read as a document with nothing in it.
    const w = await openDetail([ACTIVATION]);
    expect(w.text()).not.toContain('No line items');
  });

  it('leaves a document with no movements exactly as it was', async () => {
    const w = await openDetail([], [{ lineNo: 1, description: 'Paper', qty: '1', unitPrice: '100', lineAmount: '100' }]);
    expect(w.find('[data-testid="budget-movements"]').exists()).toBe(false);
    expect(w.text()).toContain('Paper');
  });

  it('links the budget to its own page for a reader who may open it', async () => {
    const w = await openDetail([ACTIVATION]);
    const links = w.find('[data-testid="budget-movements"]').findAllComponents({ name: 'Button' });
    expect(links.some((b: { props: (k: string) => unknown }) => String(b.props('label')).includes('1.106'))).toBe(true);
  });

  it('still states the budget to a reader who may NOT open it', async () => {
    // A document reader holds DOC_VIEW and need not hold BUDGET_VIEW. What the document says about
    // itself is their business; what the pot is worth is not — so the link goes, the text stays.
    const w = await openDetail([ACTIVATION], [], ['DOC_VIEW']);
    const panel = w.find('[data-testid="budget-movements"]');
    expect(panel.text()).toContain('1.106');
    expect(panel.findAllComponents({ name: 'Button' })).toHaveLength(0);
  });
});

describe('the approve dialog says it too, before the decision', () => {
  async function openDialog(budgetMovements: unknown[]) {
    vi.spyOn(documentsApi, 'detail').mockResolvedValue({
      document: { id: 'doc-1', docNo: 'BUDGET_PLAN-HAL-2026-0001', status: 'IN_APPROVAL', totalAmount: '12000000.00' },
      fieldValues: [], lines: [], attachments: [], refDocument: null, hasPayment: false,
      budgetMovements,
    } as never);
    vi.spyOn(documentsApi, 'canAct').mockResolvedValue(true as never);

    // Mounted CLOSED and then opened: the dialog loads on the visible watcher, which does not fire
    // for a value it was born with. Opening it is also what a reviewer actually does.
    const w = await mountView(ReviewApprovalDialog, {
      permissions: PERMS,
      props: { docId: 'doc-1', docNo: 'BUDGET_PLAN-HAL-2026-0001', visible: false },
      initialState: { auth: { permissions: PERMS, baseCurrency: { code: 'LAK', decimalPlaces: 0 } } },
    });
    await w.setProps({ visible: true });
    await flushPromises();
    await flushPromises();
    wrapper = w;
    return w;
  }

  it('names the budget beside the amount being approved', async () => {
    await openDialog([ACTIVATION]);
    // The dialog teleports to body, so read the document rather than the wrapper.
    const text = document.body.textContent ?? '';
    expect(text).toContain('1.106');
    expect(text).toContain('Support, subsidies and other (state)');
    expect(text).toContain('Activate budget plan');
  });

  it('shows no movement section for a document that moves no budget', async () => {
    await openDialog([]);
    expect(document.body.querySelector('[data-testid="budget-movements"]')).toBeNull();
    // and the figure it always showed is still there
    expect(document.body.textContent).toContain('12,000,000');
  });
});
