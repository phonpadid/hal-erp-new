import { flushPromises } from '@vue/test-utils';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { mountView } from '../../test/mountView';
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

  it('leaves the picker read-only, which is what made the omission fatal', async () => {
    // Locking the field in edit mode is deliberate and fine on its own; it only became a dead end
    // because the value was missing too. Both halves are pinned together so a later change to
    // either one has to face the other.
    const w = await openDraftForEdit('t-issue');
    const el = w.find('#warehouse').element.closest('.p-select');
    expect(el?.classList.contains('p-disabled')).toBe(true);
  });
});
