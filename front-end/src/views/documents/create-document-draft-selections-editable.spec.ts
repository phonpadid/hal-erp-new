import { flushPromises } from '@vue/test-utils';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { mountView } from '../../test/mountView';
import CreateDocumentView from './CreateDocumentView.vue';
import { useDocumentsStore } from '../../stores/documents';

/**
 * Whether a draft's type-driven selections can still be CHOSEN — the other half of restoring them.
 *
 * Restoring the saved value rescued the drafts that had one. A draft that never had one was still
 * stuck: required by the step gate, empty, and disabled, with no way for the requester to answer.
 * That state needs nobody's mistake to reach — a type gains `requiresWarehouse` or
 * `requiresEmployee` and every existing draft of it is stranded at once.
 *
 * So the lock now follows the SERVER's rule (DRAFT or not) rather than the mere fact of editing,
 * and the save carries the choice through `PATCH /documents/:id/selections`.
 *
 * Original docblock, still true of the sibling file:
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
      // A payee-bearing type whose own `requires_vendor` is OFF — the RECBL shape. The payee is one
      // of a vendor's accounts, so this type still has to offer a vendor picker or its payee can
      // never be chosen and the document can never be submitted.
      { id: 't-disb', code: 'DISB', name: 'Disbursement', category: 'FINANCE', ...b, requiresPayee: true, postAction: 'CUT_BUDGET' },
      // Accrues on approval, so a line carrying a tax code makes the supplier invoice required —
      // the shape the invoice submit gate is about.
      { id: 't-vat', code: 'VAT', name: 'VAT purchase', category: 'FINANCE', ...b, accruesOnApproval: true },
      // Records what already happened, so it may state the day its money moved — the only kind of
      // type whose draft carries that day at all.
      { id: 't-past', code: 'PAST', name: 'Recorded spend', category: 'FINANCE', ...b, recordsPastEvents: true },
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
      formForType: vi.fn(() => Promise.resolve({ documentTypeId: 't-issue', formTemplateId: 'tmpl', version: 1, fields: [] })),
      approvalLog: vi.fn(() => Promise.resolve([])),
    },
    uploadAttachment: vi.fn(),
  };
});

vi.mock('../../api/currency', () => ({
  currencyApi: {
    rates: { resolve: vi.fn(() => Promise.resolve({ rate: '690' })) },
    currencies: {
      // The picker offers the ACTIVE currencies; a retired one is not offerable, which is the same
      // reach the server holds the correction to.
      selectable: vi.fn(() =>
        Promise.resolve([
          { code: 'LAK', name: 'Kip', decimalPlaces: 0 },
          { code: 'THB', name: 'Baht', decimalPlaces: 2 },
        ]),
      ),
    },
  },
}));
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
      vendors: {
        ...(md.vendors as object),
        enabled: vi.fn(() => Promise.resolve([{ id: 'v-1', vendorCode: 'V1', name: 'Acme' }])),
      },
      vendorBankAccounts: {
        ...(md.vendorBankAccounts as object),
        list: vi.fn(() =>
          Promise.resolve([
            { id: 'vba-1', bankCode: 'BCEL', accountNo: '0101', accountName: 'Acme', isPrimary: true, isActive: true },
          ]),
        ),
      },
    },
  };
});

beforeAll(() => { i18n.global.locale.value = 'en'; });
afterAll(() => { i18n.global.locale.value = 'la'; });

/** Open a document for edit with an arbitrary status and set of selections. */
async function openForEdit(current: Record<string, unknown>, query?: Record<string, string>) {
  const w = await mountView(CreateDocumentView, {
    path: '/documents/:id/edit',
    routeName: 'document-edit',
    routeParams: { id: 'd-1' },
    query,
    initialState: { documents: { current, fieldValues: [], lines: [], attachments: [] } },
    permissions: ['DOC_SUBMIT', 'DOC_CREATE', 'MASTER_VIEW'],
  });
  await flushPromises();
  await flushPromises();
  return w;
}

function locked(w: Awaited<ReturnType<typeof openForEdit>>, inputId: string): boolean {
  const found = w.find(`#${inputId}`);
  if (!found.exists()) throw new Error(`the ${inputId} picker did not render at all`);
  return found.element.closest('.p-select')?.classList.contains('p-disabled') ?? false;
}

describe('a draft\'s type-driven selections can still be chosen', () => {
  it('offers a usable warehouse picker on a draft that names none', async () => {
    // The whole dead end in one case: required by the step gate, empty, and — until now — disabled,
    // so the requester was shown a field they had to fill and could not.
    const w = await openForEdit({ id: 'd-1', documentType: { id: 't-issue' }, status: 'DRAFT' });

    expect(locked(w, 'warehouse')).toBe(false);
  });

  it('offers a usable employee picker on a draft that names nobody', async () => {
    // Reachable without any mistake: a type gains `requiresEmployee` after its drafts exist.
    const w = await openForEdit({ id: 'd-1', documentType: { id: 't-promo' }, status: 'DRAFT' });

    expect(locked(w, 'employee')).toBe(false);
  });

  it('offers both ends of a transfer on a draft', async () => {
    const w = await openForEdit({ id: 'd-1', documentType: { id: 't-xfer' }, status: 'DRAFT' });

    expect(locked(w, 'warehouse')).toBe(false);
    expect(locked(w, 'dest-warehouse')).toBe(false);
  });

  it('locks the picker once the document has left DRAFT', async () => {
    // Where the approval chain starts caring: what the approvers approved is what gets acted on,
    // and the server refuses the change, so the control must not invite it.
    const w = await openForEdit({
      id: 'd-1', documentType: { id: 't-issue' }, warehouse: 'w-main', status: 'IN_APPROVAL',
    });

    expect(locked(w, 'warehouse')).toBe(true);
  });

  it('locks it on an approved document too', async () => {
    const w = await openForEdit({
      id: 'd-1', documentType: { id: 't-issue' }, warehouse: 'w-main', status: 'COMPLETED',
    });

    expect(locked(w, 'warehouse')).toBe(true);
  });

  it('keeps the picker locked while the document is still loading', async () => {
    // `current` is null before the detail read lands. Locked is the safe default: an enabled
    // control at that moment would invite an edit against a document whose status is unknown.
    const w = await mountView(CreateDocumentView, {
      path: '/documents/:id/edit',
      routeName: 'document-edit',
      routeParams: { id: 'd-1' },
      initialState: { documents: { current: null, fieldValues: [], lines: [], attachments: [] } },
      permissions: ['DOC_SUBMIT', 'DOC_CREATE', 'MASTER_VIEW'],
    });
    await flushPromises();
    // The type step renders no selection picker at all without a type, which is itself the
    // guarantee: there is no control to mis-enable. Assert that rather than a class that is absent
    // because the element is.
    expect(w.find('#warehouse').exists()).toBe(false);
  });
});

describe('saving an edited draft carries the selections', () => {
  it('sends all four, so a corrected value is persisted rather than discarded', async () => {
    // Before the route behind this existed, `saveDraft` wrote only fields and lines: a warehouse
    // chosen on a reopened draft was silently dropped, which is why the control was disabled.
    const w = await openForEdit({
      id: 'd-1', documentType: { id: 't-issue' }, warehouse: 'w-main', status: 'DRAFT',
    });
    const docs = useDocumentsStore();

    await (w.vm as unknown as { save: (submit?: boolean) => Promise<void> }).save?.(false);
    await flushPromises();

    expect(docs.saveDraft).toHaveBeenCalled();
    const args = (docs.saveDraft as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(args[3]).toMatchObject({ warehouseId: 'w-main' });
  });

  it('sends the payee too, so a requires_payee draft can be finished from here', async () => {
    // The bug behind RECBL-HAL-2026-0001: the payee was missing from this list while the picker
    // beside it was editable. The user chose an account, saved, and the choice went nowhere — so
    // the server kept refusing the submit for the one field the screen showed as filled, and no
    // amount of re-editing could answer it.
    const w = await openForEdit({
      id: 'd-1', documentType: { id: 't-disb' }, vendor: { id: 'v-1' }, status: 'DRAFT',
    });
    const docs = useDocumentsStore();

    (w.vm as unknown as { vendorBankAccountId: string }).vendorBankAccountId = 'vba-1';
    await (w.vm as unknown as { save: (submit?: boolean) => Promise<void> }).save?.(false);
    await flushPromises();

    const args = (docs.saveDraft as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(args[3]).toMatchObject({ vendorBankAccountId: 'vba-1' });
  });

  it('sends the currency, so a draft raised in the wrong one can be corrected', async () => {
    // The bug behind REC-HAL-2026-0026. The picker was enabled, the totals and the base preview
    // recomputed live as it changed, the Review step printed the new currency and the save reported
    // success — while the edit branch's hand-written payload never carried it. The approver went on
    // returning the document for an amount stated in the wrong unit, four times, and the one
    // correction that answered them was the one the document could not carry.
    const w = await openForEdit({
      id: 'd-1', documentType: { id: 't-disb' }, vendor: { id: 'v-1' },
      currency: { code: 'LAK' }, status: 'DRAFT',
    });
    const docs = useDocumentsStore();

    (w.vm as unknown as { currency: string }).currency = 'THB';
    await (w.vm as unknown as { save: (submit?: boolean) => Promise<void> }).save?.(false);
    await flushPromises();

    const args = (docs.saveDraft as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(args[3]).toMatchObject({ currency: 'THB' });
  });

  it('reports a refused save rather than confirming one that did not happen', async () => {
    // The half that made the original bug invisible: three calls that all succeeded, so nothing
    // contradicted the toast. A save whose selections are refused must not read as saved.
    const w = await openForEdit({
      id: 'd-1', documentType: { id: 't-disb' }, vendor: { id: 'v-1' },
      currency: { code: 'LAK' }, status: 'DRAFT',
    });
    const docs = useDocumentsStore();
    (docs.saveDraft as unknown as { mockResolvedValueOnce: (v: boolean) => void }).mockResolvedValueOnce(false);

    (w.vm as unknown as { currency: string }).currency = 'THB';
    await (w.vm as unknown as { save: (submit?: boolean) => Promise<void> }).save?.(false);
    await flushPromises();

    // It did not go on to submit or to navigate away as a successful save does.
    expect(docs.submit).not.toHaveBeenCalled();
  });

  it('locks the currency picker once the document has left DRAFT', async () => {
    const w = await openForEdit({
      id: 'd-1', documentType: { id: 't-disb' }, currency: { code: 'LAK' }, status: 'IN_APPROVAL',
    });

    expect(locked(w, 'currency')).toBe(true);
  });

  it('still sends every other selection alongside it', async () => {
    // The regression this refactor could cause: the edit payload is now DERIVED from the header
    // list rather than restated, so the derivation has to reach what the hand-written object did.
    const w = await openForEdit({
      id: 'd-1', documentType: { id: 't-issue' }, warehouse: 'w-main',
      currency: { code: 'LAK' }, status: 'DRAFT',
    });
    const docs = useDocumentsStore();

    await (w.vm as unknown as { save: (submit?: boolean) => Promise<void> }).save?.(false);
    await flushPromises();

    const args = (docs.saveDraft as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(args[3]).toMatchObject({ warehouseId: 'w-main', currency: 'LAK' });
    // Absent selections stay expressible as null, so clearing one still works.
    expect(args[3]).toHaveProperty('relatedEmployeeId', null);
  });

  it("sends the supplier invoice, so a reopened draft's can be corrected", async () => {
    // The third value to go missing from the edit payload, after the payee and the currency — and
    // the one with a route already waiting for it. The field is marked required, validated, and was
    // discarded on save, so submit went on refusing the document for input VAT with no invoice while
    // the screen showed one filled in.
    const w = await openForEdit({
      id: 'd-1', documentType: { id: 't-disb' }, vendor: { id: 'v-1' },
      vendorInvoiceNo: 'INV-OLD', vendorInvoiceDate: '2026-01-01', status: 'DRAFT',
    });
    const docs = useDocumentsStore();
    const vm = w.vm as unknown as Record<string, unknown>;

    vm.vendorInvoiceNo = 'INV-CORRECTED';
    vm.vendorInvoiceDate = '2026-09-30';
    await (vm.save as (s?: boolean) => Promise<void>)(false);
    await flushPromises();

    const args = (docs.saveDraft as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(args[4]).toMatchObject({
      vendorInvoiceNo: 'INV-CORRECTED',
      vendorInvoiceDate: '2026-09-30',
    });
  });

  it('sends the restored invoice even when its fields are not shown', async () => {
    // `needsInvoice` is `accrues_on_approval && a line carries a tax code`, so it can go false while
    // the document still legitimately holds an invoice. Gating the send on visibility would clear a
    // stored invoice as a side effect of editing an unrelated line — this type shows no invoice
    // fields at all, and the value must still survive the save.
    const w = await openForEdit({
      id: 'd-1', documentType: { id: 't-issue' }, warehouse: 'w-main',
      vendorInvoiceNo: 'INV-KEEP', vendorInvoiceDate: '2026-02-02', status: 'DRAFT',
    });
    const docs = useDocumentsStore();

    expect(w.find('[data-testid="invoice-fields"]').exists()).toBe(false);
    await (w.vm as unknown as { save: (s?: boolean) => Promise<void> }).save?.(false);
    await flushPromises();

    const args = (docs.saveDraft as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(args[4]).toMatchObject({ vendorInvoiceNo: 'INV-KEEP', vendorInvoiceDate: '2026-02-02' });
  });

  it('does not report success when the invoice write is refused', async () => {
    const w = await openForEdit({
      id: 'd-1', documentType: { id: 't-disb' }, vendor: { id: 'v-1' },
      vendorInvoiceNo: 'INV-OLD', status: 'DRAFT',
    });
    const docs = useDocumentsStore();
    (docs.saveDraft as unknown as { mockResolvedValueOnce: (v: boolean) => void }).mockResolvedValueOnce(false);

    (w.vm as unknown as { vendorInvoiceNo: string }).vendorInvoiceNo = 'INV-NEW';
    await (w.vm as unknown as { save: (s?: boolean) => Promise<void> }).save?.(false);
    await flushPromises();

    expect(docs.submit).not.toHaveBeenCalled();
  });

  it('carries the invoice and the selections on the same save', async () => {
    // Both payloads come off the one `headerFields` list now; this is what stops them drifting
    // apart again the way the hand-written object let them.
    const w = await openForEdit({
      id: 'd-1', documentType: { id: 't-issue' }, warehouse: 'w-main',
      currency: { code: 'LAK' }, vendorInvoiceNo: 'INV-1', status: 'DRAFT',
    });
    const docs = useDocumentsStore();

    await (w.vm as unknown as { save: (s?: boolean) => Promise<void> }).save?.(false);
    await flushPromises();

    const args = (docs.saveDraft as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(args[3]).toMatchObject({ warehouseId: 'w-main', currency: 'LAK' });
    expect(args[4]).toMatchObject({ vendorInvoiceNo: 'INV-1' });
  });

  it('locks the invoice inputs once the document has left DRAFT', async () => {
    // The server refuses the invoice write outside DRAFT with its own message ("return it first"),
    // so the control must not invite it — the same rule the pickers beside it already follow.
    const w = await openForEdit(
      { id: 'd-1', documentType: { id: 't-vat' }, vendorInvoiceNo: 'INV-1', status: 'IN_APPROVAL' },
      { step: 'lines' },
    );
    const vm = w.vm as unknown as Record<string, unknown>;
    // The fields appear only once a line carries a tax code — that is when the document claims
    // input VAT and the invoice becomes a fact about it.
    (vm.lines as Array<Record<string, unknown>>).push({
      lineNo: 1, description: 'x', qty: '1', unitPrice: '1', taxCodeId: 'vat-7',
    });
    await flushPromises();

    const el = w.find('[data-testid="invoice-no"]');
    expect(el.exists()).toBe(true);
    expect(el.attributes('disabled')).toBeDefined();
  });

  it('sends the day money moved, so a reopened draft can be re-dated', async () => {
    // The last of the three, and the only one whose loss is silent end to end: nothing at submit
    // requires it, so a document carrying the wrong day completed normally and misreported the
    // period of its spend. It is the txn_date of every budget_txn row the document writes.
    const w = await openForEdit(
      { id: 'd-1', documentType: { id: 't-past' }, moneyMovedOn: '2026-01-15', status: 'DRAFT' },
      { step: 'lines' },
    );
    const docs = useDocumentsStore();

    (w.vm as unknown as { moneyMovedOn: Date | null }).moneyMovedOn = new Date('2026-03-20T00:00:00');
    await (w.vm as unknown as { save: (s?: boolean) => Promise<void> }).save?.(false);
    await flushPromises();

    const args = (docs.saveDraft as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(args[5]).toMatchObject({ moneyMovedOn: '2026-03-20' });
  });

  it('does not report success when the day is refused', async () => {
    // A backdate the server forbids answers 403. Swallowed, it would be the original bug again:
    // a save that reports success for a value it did not keep.
    const w = await openForEdit(
      { id: 'd-1', documentType: { id: 't-past' }, moneyMovedOn: '2026-01-15', status: 'DRAFT' },
      { step: 'lines' },
    );
    const docs = useDocumentsStore();
    (docs.saveDraft as unknown as { mockResolvedValueOnce: (v: boolean) => void }).mockResolvedValueOnce(false);

    (w.vm as unknown as { moneyMovedOn: Date | null }).moneyMovedOn = new Date('2026-03-20T00:00:00');
    await (w.vm as unknown as { save: (s?: boolean) => Promise<void> }).save?.(false);
    await flushPromises();

    expect(docs.submit).not.toHaveBeenCalled();
  });

  it('locks the day picker once the document has left DRAFT', async () => {
    const w = await openForEdit(
      { id: 'd-1', documentType: { id: 't-past' }, moneyMovedOn: '2026-01-15', status: 'IN_APPROVAL' },
      { step: 'lines' },
    );

    const el = w.find('#money-moved-on');
    expect(el.exists()).toBe(true);
    expect(el.attributes('disabled')).toBeDefined();
  });

  it('carries all three header payloads on one save', async () => {
    // The whole point of deriving each from `headerFields`: they cannot drift apart again.
    const w = await openForEdit(
      {
        id: 'd-1', documentType: { id: 't-past' }, currency: { code: 'LAK' },
        vendorInvoiceNo: 'INV-1', moneyMovedOn: '2026-01-15', status: 'DRAFT',
      },
      { step: 'lines' },
    );
    const docs = useDocumentsStore();

    await (w.vm as unknown as { save: (s?: boolean) => Promise<void> }).save?.(false);
    await flushPromises();

    const args = (docs.saveDraft as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(args[3]).toMatchObject({ currency: 'LAK' });
    expect(args[4]).toMatchObject({ vendorInvoiceNo: 'INV-1' });
    expect(args[5]).toMatchObject({ moneyMovedOn: '2026-01-15' });
  });

  it('offers a vendor picker for a payee-bearing type that does not itself require a vendor', async () => {
    // The other half of the same dead end, and pure configuration: with no vendor there are no
    // accounts to offer, so the payee picker stays disabled and the type is unsubmittable by
    // config alone. The picker follows what the payee NEEDS, not `requires_vendor` alone.
    const w = await openForEdit({ id: 'd-1', documentType: { id: 't-disb' }, status: 'DRAFT' });

    expect(w.find('#vendor').exists()).toBe(true);
    expect(locked(w, 'vendor')).toBe(false);
  });

  it('refuses to submit a requires_payee draft with no payee, instead of letting the server 400', async () => {
    const w = await openForEdit({ id: 'd-1', documentType: { id: 't-disb' }, status: 'DRAFT' });
    const docs = useDocumentsStore();
    const vm = w.vm as unknown as {
      vendorBankAccountId: string;
      save: (submit?: boolean) => Promise<void>;
      error: string;
    };

    vm.vendorBankAccountId = '';
    await vm.save(true);
    await flushPromises();

    expect(docs.saveDraft).not.toHaveBeenCalled();
    // The wizard's own payee message, shown on this screen, rather than the server's 400 arriving
    // on the detail screen about a control that lives here.
    expect(vm.error).toBe(i18n.global.t('documents.create.payeeRequired'));
  });
});
