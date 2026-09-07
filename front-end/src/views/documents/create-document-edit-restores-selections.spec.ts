import { flushPromises } from '@vue/test-utils';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { mountView } from '../../test/mountView';
import { useDocumentsStore } from '../../stores/documents';
import CreateDocumentView from './CreateDocumentView.vue';

/**
 * Reopening a draft has to bring back everything the wizard collected, not just the parts the FORM
 * collected.
 *
 * The type-step selections — warehouse, destination warehouse, related employee — were never
 * assigned when a draft loaded, while `vendorId` beside them was. Each is `:disabled` in edit mode
 * and `:invalid` when empty, and the type step will not advance without one, so a draft of any type
 * with `requiresWarehouse` or `requiresEmployee` came back blank, greyed out, and stuck: the user
 * was shown a required field they had already filled and could not fill again.
 *
 * These assert the RENDERED value of the picker, not the ref behind it — the ref was never the
 * thing the user was blocked by.
 */
const { TYPES } = vi.hoisted(() => {
  const b = {
    requiresBudget: false, requiresQuota: false, requiresVendor: false, requiresItem: false,
    requiresPayee: false, requiresWarehouse: false, requiresEmployee: false, accruesOnApproval: false,
  };
  return {
    TYPES: [
      { id: 't-issue', code: 'ISSUE', name: 'Goods Issue', category: 'STOCK', ...b, requiresWarehouse: true, requiresItem: true, postAction: 'ISSUE_STOCK' },
      { id: 't-xfer', code: 'XFER', name: 'Stock Transfer', category: 'STOCK', ...b, requiresWarehouse: true, postAction: 'TRANSFER_STOCK' },
      { id: 't-promo', code: 'PROMOTE', name: 'Promotion', category: 'HR', ...b, requiresEmployee: true },
      { id: 't-hist', code: 'SPEND_HIST', name: 'Recorded spend', category: 'FINANCE', ...b, requiresBudget: true, recordsPastEvents: true, postAction: 'CUT_BUDGET' },
    ],
  };
});

/**
 * The draft as the store holds it after `loadDetail`. Seeded through `initialState` rather than
 * mocked at the API, because `mountView` stubs store ACTIONS — `loadDetail` is a no-op there, so a
 * mocked endpoint would never reach `docs.current` and the view would render as if nothing loaded.
 *
 * Every one of these three has always been in the detail payload; only the assignment was missing.
 */
const draftOf = (documentTypeId: string) => ({
  id: 'd-1',
  // `documentType` is populated by the detail read; the three below are NOT, so they arrive as
  // bare ids. Copied from a real response rather than imagined — a fixture built with `{ id }`
  // objects made a broken fix pass, because `?.id` on an object is exactly what the wrong fix
  // read and exactly what the wrong fixture supplied.
  documentType: { id: documentTypeId },
  warehouse: 'w-main',
  destWarehouse: 'w-site',
  relatedEmployee: 'e-1',
  status: 'DRAFT',
});

vi.mock('../../api/documents', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return {
    ...actual,
    documentsApi: {
      ...(actual.documentsApi as object),
      creatableTypes: vi.fn(() => Promise.resolve(TYPES)),
      formForType: vi.fn(() => Promise.resolve({ documentTypeId: 't-issue', formTemplateId: 'tmpl', version: 1, fields: [] })),
      approvalLog: vi.fn(() => Promise.resolve([])),
    },
    uploadAttachment: vi.fn(),
  };
});

vi.mock('../../api/currency', () => ({
  currencyApi: { rates: { resolve: vi.fn(() => Promise.resolve({ rate: '1' })) } },
}));
vi.mock('../../api/budgets', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return {
    ...actual,
    budgetsApi: {
      ...(actual.budgetsApi as object),
      selectable: vi.fn(() =>
        Promise.resolve([{ id: 'b-106', code: '1.106', budgetName: 'Support', parentId: null, parentCode: null, parentName: null }]),
      ),
    },
  };
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
      selectableWarehouses: vi.fn(() => Promise.resolve([
        { id: 'w-main', code: 'MAIN', name: 'Main store' },
        { id: 'w-site', code: 'SITE', name: 'Site store' },
      ])),
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
  const md = actual.masterDataApi as Record<string, unknown>;
  return {
    ...actual,
    masterDataApi: {
      ...md,
      items: { ...(md.items as object), enabled: vi.fn(() => Promise.resolve([])) },
      vendors: { ...(md.vendors as object), enabled: vi.fn(() => Promise.resolve([])) },
    },
  };
});

beforeAll(() => { i18n.global.locale.value = 'en'; });
afterAll(() => { i18n.global.locale.value = 'la'; });

/** Each picker renders only for a type whose flags ask for it, so the type is the parameter. */
async function openDraftForEdit(documentTypeId: string) {
  const w = await mountView(CreateDocumentView, {
    path: '/documents/:id/edit',
    routeName: 'document-edit',
    routeParams: { id: 'd-1' },
    initialState: {
      documents: { current: draftOf(documentTypeId), fieldValues: [], lines: [], attachments: [] },
    },
    permissions: ['DOC_SUBMIT', 'DOC_CREATE', 'MASTER_VIEW'],
  });
  await flushPromises();
  await flushPromises();
  return w;
}

/** What a picker actually displays — the label, not the bound id. */
function shownValue(w: Awaited<ReturnType<typeof openDraftForEdit>>, inputId: string): string {
  const found = w.find(`#${inputId}`);
  if (!found.exists()) throw new Error(`the ${inputId} picker did not render at all`);
  // `textContent`, not `innerText` — jsdom does not implement the latter and it comes back
  // undefined, which reads as "the picker rendered nothing" rather than as a broken assertion.
  const el = found.element.closest('.p-select');
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe('reopening a draft restores the selections the type asked for', () => {
  it('shows the warehouse a goods issue was saved with', async () => {
    const w = await openDraftForEdit('t-issue');
    expect(shownValue(w, 'warehouse')).toContain('MAIN');
  });

  it('does not show the placeholder in its place', async () => {
    // The failure mode: a required field rendering as if nothing had ever been chosen.
    const w = await openDraftForEdit('t-issue');
    expect(shownValue(w, 'warehouse')).not.toMatch(/select/i);
  });

  it('shows both warehouses of a stock transfer', async () => {
    const w = await openDraftForEdit('t-xfer');
    expect(shownValue(w, 'warehouse')).toContain('MAIN');
    expect(shownValue(w, 'dest-warehouse')).toContain('SITE');
  });

  it('shows the employee a personnel document is about', async () => {
    const w = await openDraftForEdit('t-promo');
    expect(shownValue(w, 'employee')).toContain('EMP-REQ');
  });

  it('also accepts a populated relation, if the detail read ever starts sending one', async () => {
    // The shape is the server's to choose and it has changed before. Reading only one of the two
    // is how this was got wrong the first time.
    const w = await mountView(CreateDocumentView, {
      path: '/documents/:id/edit',
      routeName: 'document-edit',
      routeParams: { id: 'd-1' },
      initialState: {
        documents: {
          current: {
            id: 'd-1',
            documentType: { id: 't-issue' },
            warehouse: { id: 'w-main', code: 'MAIN', name: 'Main store' },
            status: 'DRAFT',
          },
          fieldValues: [], lines: [], attachments: [],
        },
      },
      permissions: ['DOC_SUBMIT', 'DOC_CREATE', 'MASTER_VIEW'],
    });
    await flushPromises();
    await flushPromises();
    expect(shownValue(w, 'warehouse')).toContain('MAIN');
  });

  it('leaves the picker usable, so a restored value is not the only way out', async () => {
    // This assertion used to read the other way, and the comment under it argued that locking the
    // field in edit mode was "fine on its own" because the value came back. It was not: a draft
    // that never HAD a value — saved without one, or belonging to a type that gained the flag
    // afterwards — was still blank, disabled and required at once. Restoring the value fixed the
    // drafts that had one; only unlocking the control fixes the rest. See
    // `create-document-draft-selections-editable.spec.ts` for the lock's actual rule.
    const w = await openDraftForEdit('t-issue');
    const el = w.find('#warehouse').element.closest('.p-select');
    expect(el?.classList.contains('p-disabled')).toBe(false);
  });
});

/**
 * The same omission, one layer down and one release later.
 *
 * A line's budget arrives POPULATED — the detail read returns `budget` and carries no `budgetId` at
 * all — so the mapping that read `l.budgetId` restored nothing, and the picker reopened empty and
 * marked required. The date beside it was never assigned in the first place. Both are silent: a
 * user re-picks the budget, saves the amount they came to fix, and the day the money moved goes
 * with it — into whichever quarter they were editing in.
 *
 * These read the STATE rather than the rendering, unlike the block above, and the difference is the
 * failure mode. A blocked picker is a rendering problem — the user is stopped and can see it. These
 * three are lost on SAVE: the payload is built from the refs, so a ref the load left empty is a
 * value the next save silently clears. What is asserted is what gets sent.
 */
/** The setup state these assertions are about. `<script setup>` exposes no types to the test. */
type EditState = {
  lines: Array<{ budgetId: string }>;
  moneyMovedOn: Date | null;
  vendorInvoiceNo: string;
  vendorInvoiceDate: string;
};
const stateOf = (w: { vm: unknown }): EditState => w.vm as unknown as EditState;
describe('reopening a draft restores what was saved on the document and its lines', () => {
  const spendDraft = {
    id: 'd-1',
    documentType: { id: 't-hist' },
    status: 'DRAFT',
    // Exactly the shape the detail read returns: populated, no bare id beside it.
    moneyMovedOn: '2026-03-14',
    vendorInvoiceNo: 'INV-77',
    vendorInvoiceDate: '2026-03-10',
  };
  const spendLines = [
    { description: 'Q1 spend', qty: '1', unitPrice: '3000000', budget: { id: 'b-106', code: '1.106' } },
  ];

  async function openSpendDraft() {
    const w = await mountView(CreateDocumentView, {
      path: '/documents/:id/edit',
      routeName: 'document-edit',
      routeParams: { id: 'd-1' },
      initialState: {
        documents: { current: spendDraft, fieldValues: [], lines: spendLines, attachments: [] },
      },
      permissions: ['DOC_SUBMIT', 'DOC_CREATE', 'MASTER_VIEW', 'DOC_BACKDATE'],
    });
    await flushPromises();
    await flushPromises();
    return w;
  }

  it("restores the line's budget from the populated relation the read returns", async () => {
    const w = await openSpendDraft();
    expect(stateOf(w).lines[0].budgetId).toBe('b-106');
  });

  it('restores the day the money moved', async () => {
    const w = await openSpendDraft();
    const d = stateOf(w).moneyMovedOn;
    expect(d).toBeInstanceOf(Date);
    // Local midnight, not UTC: parsed as a bare date this reads as the 13th anywhere east of UTC.
    expect(`${d!.getFullYear()}-${String(d!.getMonth() + 1).padStart(2, '0')}-${String(d!.getDate()).padStart(2, '0')}`)
      .toBe('2026-03-14');
  });

  it("restores the supplier's invoice, which submit demands back", async () => {
    const w = await openSpendDraft();
    expect(stateOf(w).vendorInvoiceNo).toBe('INV-77');
    expect(stateOf(w).vendorInvoiceDate).toBe('2026-03-10');
  });

  it('still accepts a bare id, so a read that flattens later keeps working', async () => {
    const w = await mountView(CreateDocumentView, {
      path: '/documents/:id/edit',
      routeName: 'document-edit',
      routeParams: { id: 'd-1' },
      initialState: {
        documents: {
          current: spendDraft,
          fieldValues: [],
          lines: [{ description: 'Q1 spend', qty: '1', unitPrice: '3000000', budgetId: 'b-106' }],
          attachments: [],
        },
      },
      permissions: ['DOC_SUBMIT', 'DOC_CREATE', 'MASTER_VIEW', 'DOC_BACKDATE'],
    });
    await flushPromises();
    await flushPromises();
    expect(stateOf(w).lines[0].budgetId).toBe('b-106');
  });
});


/**
 * Restoring the value is not the end of it: what the next SAVE sends has to still contain it.
 *
 * The regression that started this change is exactly this shape — reopen a recorded spend, correct
 * the amount, save. The day the money moved was never restored, so the form held nothing to send
 * and nothing to show, and the spend would have been counted in the quarter it was edited in
 * rather than the one it happened in. `budget_txn` is append-only, so that quarter could only be
 * answered afterwards, never corrected.
 */
describe('saving a reopened draft keeps what the load restored', () => {
  const spendDraft = {
    id: 'd-1',
    documentType: { id: 't-hist' },
    status: 'DRAFT',
    moneyMovedOn: '2026-03-14',
    vendorInvoiceNo: 'INV-77',
    vendorInvoiceDate: '2026-03-10',
  };

  async function openSpendDraft(lines: unknown[]) {
    const w = await mountView(CreateDocumentView, {
      path: '/documents/:id/edit',
      routeName: 'document-edit',
      routeParams: { id: 'd-1' },
      initialState: {
        documents: { current: spendDraft, fieldValues: [], lines, attachments: [] },
      },
      permissions: ['DOC_SUBMIT', 'DOC_CREATE', 'MASTER_VIEW', 'DOC_BACKDATE'],
    });
    await flushPromises();
    await flushPromises();
    return w;
  }

  it('sends the corrected amount and still holds the day the money moved', async () => {
    const w = await openSpendDraft([
      { description: 'Q1 spend', qty: '1', unitPrice: '3000000', budget: { id: 'b-106', code: '1.106' } },
    ]);
    const st = stateOf(w) as EditState & { lines: Array<{ unitPrice: string }> };
    st.lines[0].unitPrice = '4000000';

    await (w.vm as unknown as { save: (submit?: boolean) => Promise<void> }).save(false);
    await flushPromises();

    const docs = useDocumentsStore();
    const args = (docs.saveDraft as unknown as { mock: { calls: any[][] } }).mock.calls[0];
    expect(args[2][0]).toMatchObject({ unitPrice: '4000000', budgetId: 'b-106' });
    // The day survives the save it was not part of. Before the restore it was null here, and a
    // form holding null is one keystroke away from writing null.
    const d = stateOf(w).moneyMovedOn!;
    expect(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
      .toBe('2026-03-14');
  });

  it('refuses to advance past a line whose budget is no longer offered', async () => {
    // A budget closed since the draft was saved. The id is still on the line and the picker cannot
    // show it, so without this the line reads as one nobody ever budgeted — the user re-picks, and
    // every other thing the load could not restore goes with the save.
    const w = await openSpendDraft([
      { description: 'Q1 spend', qty: '1', unitPrice: '3000000', budget: { id: 'b-closed', code: '1.999' } },
    ]);
    const vm = w.vm as unknown as { validateStep: (k: string) => true | string; lines: Array<{ budgetId: string }> };
    // Restored, not discarded: what was saved is what the server is left to refuse.
    expect(vm.lines[0].budgetId).toBe('b-closed');
    expect(vm.validateStep('lines')).toBe(
      'A line names a budget or an item that is no longer available. Choose again on that line.',
    );
  });
});

/**
 * The other direction of the same one list: a field the form owns has to reach the CREATE body.
 *
 * This is the half that was never broken for `moneyMovedOn` and was broken for
 * `vendorBankAccountId`, which made every disbursement unsubmittable. Both halves are now built
 * from `headerFields`, so this asserts the list is actually what the payload is made of.
 */
describe('creating a document carries every field the form owns', () => {
  it('puts the day, the invoice and the currency on the create body', async () => {
    const w = await mountView(CreateDocumentView, {
      permissions: ['DOC_SUBMIT', 'DOC_CREATE', 'MASTER_VIEW', 'DOC_BACKDATE'],
    });
    await flushPromises();
    const vm = w.vm as unknown as {
      selectedTypeId: string;
      moneyMovedOn: Date | null;
      vendorInvoiceNo: string;
      vendorInvoiceDate: string;
      save: (submit?: boolean) => Promise<void>;
    };
    vm.selectedTypeId = 't-hist';
    await flushPromises();
    vm.moneyMovedOn = new Date(2026, 2, 14);
    vm.vendorInvoiceNo = 'INV-77';
    vm.vendorInvoiceDate = '2026-03-10';

    await vm.save(false);
    await flushPromises();

    const docs = useDocumentsStore();
    const body = (docs.createDraft as unknown as { mock: { calls: any[][] } }).mock.calls[0][0];
    expect(body).toMatchObject({
      documentTypeId: 't-hist',
      moneyMovedOn: '2026-03-14',
      vendorInvoiceNo: 'INV-77',
      vendorInvoiceDate: '2026-03-10',
    });
  });
});
