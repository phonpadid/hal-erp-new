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
  currencyApi: { rates: { resolve: vi.fn(() => Promise.resolve({ rate: '1' })) } },
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
async function openForEdit(current: Record<string, unknown>) {
  const w = await mountView(CreateDocumentView, {
    path: '/documents/:id/edit',
    routeName: 'document-edit',
    routeParams: { id: 'd-1' },
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
