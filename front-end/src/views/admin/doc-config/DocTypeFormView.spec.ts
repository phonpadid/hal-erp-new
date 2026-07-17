import { flushPromises } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { i18n } from '../../../i18n';
import { mountView } from '../../../test/mountView';
import { useDocConfigStore } from '../../../stores/docConfig';
import DocTypeFormView from './DocTypeFormView.vue';

const TYPE_ID = '11111111-1111-4111-8111-111111111111';
const CATEGORIES = [{ id: 'c1', code: 'FINANCE', name: 'Finance', isActive: true }];
const EXISTING = {
  id: TYPE_ID,
  code: 'DISB',
  name: 'Disbursement',
  category: 'FINANCE',
  requiresBudget: true,
  requiresQuota: false,
  requiresVendor: true,
  requiresItem: false,
  requiresPayee: true,
  defaultGlAccount: '5210',
  postAction: 'CUT_BUDGET',
  isActive: true,
};

// The form pushes back to the list by name on success, so that route has to exist.
const LIST_ROUTE = [{ path: '/doc-config/types', name: 'doc-config-types' }];

// The <Form> is gated until the store data lands (it reads initialValues once), so every mount
// has to settle onMounted before the fields exist.
const mountCreate = async () => {
  const w = await mountView(DocTypeFormView, {
    path: '/doc-config/types/new',
    routeName: 'doc-config-type-new',
    permissions: ['DOC_CONFIG_MANAGE'],
    extraRoutes: LIST_ROUTE,
    initialState: { docConfig: { documentTypes: [EXISTING], categories: CATEGORIES } },
  });
  await flushPromises();
  return w;
};

const mountEdit = async (documentTypes: unknown[] = [EXISTING]) => {
  const w = await mountView(DocTypeFormView, {
    path: '/doc-config/types/:id/edit',
    routeName: 'doc-config-type-edit',
    routeParams: { id: TYPE_ID },
    permissions: ['DOC_CONFIG_MANAGE'],
    extraRoutes: LIST_ROUTE,
    initialState: { docConfig: { documentTypes, categories: CATEGORIES } },
  });
  await flushPromises();
  return w;
};

describe('DocTypeFormView', () => {
  it('creates a type from the form values and returns to the list', async () => {
    const w = await mountCreate();
    const cfg = useDocConfigStore();
    (cfg.createDocumentType as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(true);

    await w.find('#dt-code').setValue('PO');
    await w.find('#dt-name').setValue('Purchase Order');
    await w.find('form').trigger('submit');
    await flushPromises();
    await flushPromises();

    expect(cfg.createDocumentType).toHaveBeenCalledTimes(1);
    const payload = (cfg.createDocumentType as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0];
    // The category defaults to the first ACTIVE category — no hardcoded code.
    expect(payload).toMatchObject({ code: 'PO', name: 'Purchase Order', category: 'FINANCE' });
    // A successful create leaves the form for the list.
    expect(w.vm.$router.currentRoute.value.name).toBe('doc-config-types');
  });

  it('blocks a submit that the schema rejects, without calling the store', async () => {
    const w = await mountCreate();
    const cfg = useDocConfigStore();

    // Code and name left empty.
    await w.find('form').trigger('submit');
    await flushPromises();

    expect(cfg.createDocumentType).not.toHaveBeenCalled();
    expect(w.text()).toContain('A code is required');
    expect(w.text()).toContain('A name is required');
  });

  it('loads the existing type in edit mode and hides the immutable fields', async () => {
    const w = await mountEdit();
    await flushPromises();

    expect((w.find('#dt-name').element as HTMLInputElement).value).toBe('Disbursement');
    // code + category are set once at creation.
    expect(w.find('#dt-code').exists()).toBe(false);
    expect(w.find('label[for="dt-category"]').exists()).toBe(false);
  });

  it('updates the flags of an existing type', async () => {
    const w = await mountEdit();
    const cfg = useDocConfigStore();
    (cfg.updateDocumentType as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(true);
    await flushPromises();

    await w.find('form').trigger('submit');
    await flushPromises();
    await flushPromises();

    expect(cfg.updateDocumentType).toHaveBeenCalledTimes(1);
    const [id, payload] = (cfg.updateDocumentType as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(id).toBe(TYPE_ID);
    // requiresPayee survives the round trip — it is in the shared schema and the backend DTO.
    expect(payload).toMatchObject({ name: 'Disbursement', requiresPayee: true, requiresBudget: true });
  });

  // --- 2-step wizard. Step 1 = identity, step 2 = behaviour.
  // Resolve the label through i18n — the app's default locale is Lao, not English.
  const NEXT = i18n.global.t('common.next');
  const nextBtn = (w: Awaited<ReturnType<typeof mountCreate>>) =>
    w.findAll('button').find((b) => b.text().includes(NEXT))!;

  it('stays on the identity step while it is invalid', async () => {
    const w = await mountCreate();

    // Code and name empty → Next must not reveal the behaviour step.
    await nextBtn(w).trigger('click');
    await flushPromises();

    expect(w.find('#dt-code').isVisible()).toBe(true);
    expect(w.find('label[for="dt-requiresBudget"]').isVisible()).toBe(false);
  });

  it('advances to the behaviour step once the identity fields are valid', async () => {
    const w = await mountCreate();

    await w.find('#dt-code').setValue('PO');
    await w.find('#dt-name').setValue('Purchase Order');
    await nextBtn(w).trigger('click');
    await flushPromises();

    expect(w.find('label[for="dt-requiresBudget"]').isVisible()).toBe(true);
    expect(w.find('#dt-code').isVisible()).toBe(false);
  });

  // Regression: the steps are toggled with v-show, never v-if. An unmounted FormField drops its
  // value, so a v-if step 1 would submit an empty code from step 2.
  it('keeps the identity values after advancing to step 2', async () => {
    const w = await mountCreate();
    const cfg = useDocConfigStore();
    (cfg.createDocumentType as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(true);

    await w.find('#dt-code').setValue('PO');
    await w.find('#dt-name').setValue('Purchase Order');
    await nextBtn(w).trigger('click');
    await flushPromises();
    await w.find('form').trigger('submit');
    await flushPromises();
    await flushPromises();

    const payload = (cfg.createDocumentType as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0];
    expect(payload).toMatchObject({ code: 'PO', name: 'Purchase Order' });
  });

  // A stale link or a type belonging to another company must say so, not render an empty form
  // that silently creates nothing.
  it('reports a document type it cannot find', async () => {
    const w = await mountEdit([{ ...EXISTING, id: 'a-different-id' }]);
    await flushPromises();

    expect(w.find('[data-testid="type-not-found"]').exists()).toBe(true);
    expect(w.find('form').exists()).toBe(false);
  });
});
