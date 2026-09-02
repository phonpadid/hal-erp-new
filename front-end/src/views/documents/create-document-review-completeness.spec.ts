import { flushPromises } from '@vue/test-utils';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { mountView } from '../../test/mountView';
import CreateDocumentView from './CreateDocumentView.vue';

/**
 * The review step is the last screen before a document becomes somebody else's work, and it used
 * to list only the type, the currency, the vendor, the dynamic fields and the lines. The warehouse
 * a goods issue takes stock from, and the person a promotion is about, were both collected on step
 * one and then silently dropped — so what was reviewed was not what was submitted.
 *
 * It also covers the item list: a stock-moving type may only carry stock-tracked items, and
 * offering the others meant the user learned the rule from a refusal at submit.
 */

const { TYPES } = vi.hoisted(() => {
  const b = {
    requiresBudget: false, requiresQuota: false, requiresVendor: false, requiresItem: false,
    requiresPayee: false, requiresWarehouse: false, requiresEmployee: false, accruesOnApproval: false,
  };
  return {
    TYPES: [
      { id: 't-memo', code: 'MEMO', name: 'Memo', category: 'ADMIN', ...b },
      { id: 't-issue', code: 'ISSUE', name: 'Goods Issue', category: 'STOCK', ...b, requiresWarehouse: true, requiresItem: true, postAction: 'ISSUE_STOCK' },
      { id: 't-xfer', code: 'XFER', name: 'Stock Transfer', category: 'STOCK', ...b, requiresWarehouse: true, postAction: 'TRANSFER_STOCK' },
      { id: 't-promo', code: 'PROMOTE', name: 'Promotion', category: 'HR', ...b, requiresEmployee: true },
    ],
  };
});

vi.mock('../../api/documents', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return {
    ...actual,
    documentsApi: {
      ...(actual.documentsApi as object),
      creatableTypes: vi.fn(() => Promise.resolve(TYPES)),
      formForType: vi.fn(() =>
        Promise.resolve({ documentTypeId: 't-memo', formTemplateId: 'tmpl', version: 1, fields: [] }),
      ),
    },
    uploadAttachment: vi.fn(),
  };
});

vi.mock('../../api/currency', () => ({
  currencyApi: { rates: { resolve: vi.fn(() => Promise.resolve({ rate: '1' })) } },
}));

// The wizard awaits these in sequence during onMounted. Unmocked, they are real axios calls that
// never settle under jsdom, so the chain stalls before it reaches the item list — which is what
// made the first run of this file report zero items with the mock plainly working.
vi.mock('../../api/budgets', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, budgetsApi: { ...(actual.budgetsApi as object), selectable: vi.fn(() => Promise.resolve([])) } };
});

vi.mock('../../api/taxCodes', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, taxCodesApi: { ...(actual.taxCodesApi as object), selectableVat: vi.fn(() => Promise.resolve([])) } };
});

vi.mock('../../api/inventory', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return {
    ...actual,
    inventoryApi: {
      ...(actual.inventoryApi as object),
      selectableWarehouses: vi.fn(() =>
        Promise.resolve([
          { id: 'w-main', code: 'MAIN', name: 'Main store' },
          { id: 'w-site', code: 'SITE', name: 'Site store' },
        ]),
      ),
    },
  };
});

vi.mock('../../api/employees', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return {
    ...actual,
    employeesApi: {
      ...(actual.employeesApi as object),
      selectable: vi.fn(() => Promise.resolve([{ id: 'e-1', empCode: 'EMP-REQ', fullName: 'Demo Requester' }])),
    },
  };
});

vi.mock('../../api/masterData', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  const items = [
    { id: 'i-paper', itemCode: 'I001', name: 'A4 Paper', isStockTracked: false },
    { id: 'i-toner', itemCode: 'I002', name: 'Toner Cartridge', isStockTracked: false },
    { id: 'i-helmet', itemCode: 'I003', name: 'Safety Helmet', isStockTracked: true },
  ];
  const md = actual.masterDataApi as Record<string, unknown>;
  return {
    ...actual,
    masterDataApi: {
      ...md,
      items: { ...(md.items as object), enabled: vi.fn(() => Promise.resolve(items)) },
      vendors: { ...(md.vendors as object), enabled: vi.fn(() => Promise.resolve([])) },
    },
  };
});

beforeAll(() => { i18n.global.locale.value = 'en'; });
afterAll(() => { i18n.global.locale.value = 'la'; });

async function mountWizard() {
  const w = await mountView(CreateDocumentView, {
    path: '/documents/new',
    routeName: 'document-create',
    permissions: ['DOC_SUBMIT', 'DOC_CREATE', 'MASTER_VIEW'],
  });
  await flushPromises();
  return w;
}

/** Click the stepper's Next button once. Returns false when no Next button is present. */
async function next(w: Awaited<ReturnType<typeof mountWizard>>) {
  const btn = w.findAll('button').find((b) => b.text().trim() === 'Next');
  if (!btn) return false;
  await btn.trigger('click');
  await flushPromises();
  return true;
}

/**
 * Walk to the review step. The review markup only exists on that step, so a test that merely
 * selects a type and looks for a tile is looking at a screen that has not rendered yet.
 */
async function goToReview(w: Awaited<ReturnType<typeof mountWizard>>) {
  for (let i = 0; i < 5; i++) {
    if (w.find('[data-testid="review-warehouse"]').exists() || !(await next(w))) break;
  }
  // Advance until Next is gone (the review step is last, so it shows the final actions instead).
  for (let i = 0; i < 5 && (await next(w)); i++) { /* keep going */ }
}

/** Pick a type card by its visible name, then let the wizard settle. */
async function choose(w: Awaited<ReturnType<typeof mountWizard>>, name: string) {
  const card = w.findAll('[role="radio"]').find((c) => c.text().includes(name));
  if (!card) throw new Error(`no card for ${name}`);
  await card.trigger('click');
  await flushPromises();
}

describe('review step completeness', () => {
  it('shows the warehouse a goods issue takes stock from', async () => {
    const w = await mountWizard();
    await choose(w, 'Goods Issue');
    (w.vm as unknown as { warehouseId: string }).warehouseId = 'w-main';
    await flushPromises();
    await goToReview(w);

    const tile = w.find('[data-testid="review-warehouse"]');
    expect(tile.exists()).toBe(true);
    expect(tile.text()).toContain('MAIN');
  });

  it('shows the person a promotion is about', async () => {
    const w = await mountWizard();
    await choose(w, 'Promotion');
    (w.vm as unknown as { relatedEmployeeId: string }).relatedEmployeeId = 'e-1';
    await flushPromises();
    await goToReview(w);

    const tile = w.find('[data-testid="review-employee"]');
    expect(tile.exists()).toBe(true);
    expect(tile.text()).toContain('Demo Requester');
  });

  it('shows both ends of a transfer, distinguishably', async () => {
    const w = await mountWizard();
    await choose(w, 'Stock Transfer');
    const vm = w.vm as unknown as { warehouseId: string; destWarehouseId: string };
    vm.warehouseId = 'w-main';
    vm.destWarehouseId = 'w-site';
    await flushPromises();
    await goToReview(w);

    const src = w.find('[data-testid="review-warehouse"]');
    const dest = w.find('[data-testid="review-destWarehouse"]');
    expect(src.text()).toContain('MAIN');
    expect(dest.text()).toContain('SITE');
    // Two warehouses reading "Warehouse / Warehouse" would be worse than not showing them.
    expect(src.text()).not.toEqual(dest.text());
  });

  it('shows no tile for a value the type does not ask for', async () => {
    const w = await mountWizard();
    await choose(w, 'Memo');
    await goToReview(w);
    expect(w.find('[data-testid="review-warehouse"]').exists()).toBe(false);
    expect(w.find('[data-testid="review-employee"]').exists()).toBe(false);
    expect(w.find('[data-testid="review-payee"]').exists()).toBe(false);
  });

  it('derives the tiles from the type, and leaves an unanswered one empty', async () => {
    // Not reachable through the UI — step one refuses to advance without the warehouse — so this
    // asserts the derivation rather than a screen no user can get to. The template renders the
    // empty value as "required", which is what makes an edit-mode draft missing a value legible.
    const w = await mountWizard();
    await choose(w, 'Goods Issue');
    const rows = (w.vm as unknown as { reviewChoices: { key: string; value: string }[] }).reviewChoices;
    expect(rows.map((r) => r.key)).toEqual(['warehouse']);
    expect(rows[0].value).toBe('');
  });

});

describe('line editor item list', () => {
  /**
   * Read the list the editor was actually handed, not the computed behind it. Asserting the
   * computed passes even if the template still binds the unfiltered array — which is exactly what
   * a mutation of that binding proved.
   */
  async function offered(w: Awaited<ReturnType<typeof mountWizard>>) {
    // The editor lives on the lines step.
    for (let i = 0; i < 5; i++) {
      if (w.findComponent({ name: 'LineItemsEditor' }).exists()) break;
      const btn = w.findAll('button').find((b) => b.text().trim() === 'Next');
      if (!btn) break;
      await btn.trigger('click');
      await flushPromises();
    }
    const editor = w.findComponent({ name: 'LineItemsEditor' });
    expect(editor.exists()).toBe(true);
    return (editor.props('items') ?? []) as { name: string }[];
  }

  it('hands the editor only stock-tracked items on a stock-moving type', async () => {
    const w = await mountWizard();
    await choose(w, 'Goods Issue');
    (w.vm as unknown as { warehouseId: string }).warehouseId = 'w-main';
    await flushPromises();
    expect((await offered(w)).map((i) => i.name)).toEqual(['Safety Helmet']);
  });

  it('hands the editor everything on a type that does not move stock', async () => {
    const w = await mountWizard();
    await choose(w, 'Memo');
    expect(await offered(w)).toHaveLength(3);
  });
});
