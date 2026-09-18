import { flushPromises } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { mountView } from '../../../test/mountView';
import { useDocConfigStore } from '../../../stores/docConfig';
import DocTypeFormView from './DocTypeFormView.vue';

const TYPE_ID = '33333333-3333-4333-8333-333333333333';
const CATEGORIES = [{ id: 'c1', code: 'BUDGET', name: 'Budget', isActive: true }];
const PERMISSION_CODES = [
  { code: 'BUDGET_VIEW', name: 'View budgets', module: 'BUDGET' },
  { code: 'DOC_VIEW', name: 'View documents', module: 'DOCUMENT' },
];
const LIST_ROUTE = [{ path: '/doc-config/types', name: 'doc-config-types' }];

/** A budget plan: read by the people who work with budgets, whichever department it is filed in. */
const PLAN = {
  id: TYPE_ID,
  code: 'BUDGET_PLAN',
  name: 'Budget plan',
  category: 'BUDGET',
  requiresBudget: false,
  requiresQuota: false,
  requiresVendor: false,
  requiresItem: false,
  requiresPayee: false,
  postAction: 'ACTIVATE_BUDGET',
  viewPermissionCode: 'BUDGET_VIEW',
  isActive: true,
};

const mountEdit = async (dt: Record<string, unknown> = PLAN) => {
  const w = await mountView(DocTypeFormView, {
    path: '/doc-config/types/:id/edit',
    routeName: 'doc-config-type-edit',
    routeParams: { id: TYPE_ID },
    permissions: ['DOC_CONFIG_MANAGE'],
    extraRoutes: LIST_ROUTE,
    initialState: { docConfig: { documentTypes: [dt], categories: CATEGORIES, permissionCodes: PERMISSION_CODES } },
  });
  await flushPromises();
  return w;
};

const submitted = async (w: Awaited<ReturnType<typeof mountEdit>>) => {
  const cfg = useDocConfigStore();
  (cfg.updateDocumentType as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(true);
  await w.find('form').trigger('submit');
  await flushPromises();
  await flushPromises();
  return (cfg.updateDocumentType as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[1] as
    | Record<string, unknown>
    | undefined;
};

/**
 * `document_type.view_permission_code` — who may read a type — on the type form. Scope knows whose
 * department a document is in and nothing about what it is, so without this every member of a
 * department saw its budget plans beside their own requests.
 */
describe('the document-type form carries the read gate', () => {
  it('offers the catalog codes by name and shows the current gate', async () => {
    const w = await mountEdit();
    const select = w.find('[data-testid="dt-view-permission"]');
    expect(select.exists()).toBe(true);
    // The label names the code and its meaning; the value is the code alone.
    expect(select.text()).toContain('BUDGET_VIEW');
    expect(select.text()).toContain('View budgets');
  });

  it('round-trips the gate untouched', async () => {
    const w = await mountEdit();
    expect(await submitted(w)).toMatchObject({ viewPermissionCode: 'BUDGET_VIEW' });
  });

  it('sends null, never an empty string, for "no gate"', async () => {
    const w = await mountEdit({ ...PLAN, viewPermissionCode: null });
    expect(await submitted(w)).toMatchObject({ viewPermissionCode: null });
  });
});
