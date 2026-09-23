import { POST_ACTIONS, PRINT_TEMPLATES } from '@erp/shared';
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

const mountEdit = async (documentTypes: unknown[] = [EXISTING], error = '') => {
  const w = await mountView(DocTypeFormView, {
    path: '/doc-config/types/:id/edit',
    routeName: 'doc-config-type-edit',
    routeParams: { id: TYPE_ID },
    permissions: ['DOC_CONFIG_MANAGE'],
    extraRoutes: LIST_ROUTE,
    initialState: { docConfig: { documentTypes, categories: CATEGORIES, error } },
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

  // The Select used to be built from a seven-value list while the engine dispatched twelve, so a
  // stock, voucher or budget-plan type could only be created by seeding the database.
  it('offers every action the engine dispatches', async () => {
    const w = await mountCreate();
    const values = w
      .findAllComponents({ name: 'Select' })
      .flatMap((sel) => ((sel.props('options') as { value: string | null }[] | undefined) ?? []))
      .map((o) => o.value);
    for (const action of POST_ACTIONS) expect(values).toContain(action);
  });

  // A sentinel string here would have to pass the same shared schema the server's DTO mirrors —
  // so it would either be a value the column refuses or a form that cannot submit. Asserted on the
  // OPTION as well as the payload: the payload alone passes on the initial value even when the
  // option carries a sentinel, so it does not hold the rule on its own.
  it('sends null for the no-action choice, not a sentinel', async () => {
    const w = await mountCreate();
    const cfg = useDocConfigStore();
    (cfg.createDocumentType as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(true);

    // The post-action Select alone: the match-mode Select next to it carries 'NONE' as a real
    // stored value, not a sentinel for "nothing chosen".
    const values = w
      .findAllComponents({ name: 'Select' })
      .filter((sel) => sel.props('inputId') === 'dt-post-action')
      .flatMap((sel) => ((sel.props('options') as { value: unknown }[] | undefined) ?? []))
      .map((o) => o.value);
    expect(values).toContain(null);
    expect(values).not.toContain('NONE');

    await w.find('#dt-code').setValue('MEMO2');
    await w.find('#dt-name').setValue('Memo');
    await w.find('form').trigger('submit');
    await flushPromises();
    await flushPromises();

    const payload = (cfg.createDocumentType as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][0] as { postAction: unknown };
    expect(payload.postAction).toBeNull();
  });

  // Which sheet a type prints is configuration, so the form has to offer all four and default to
  // the letter — the value every type that existed before this field carries.
  it('offers every printed sheet, and starts a new type on the official letter', async () => {
    const w = await mountCreate();
    const cfg = useDocConfigStore();
    (cfg.createDocumentType as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(true);

    // The sheets live on a MultiSelect, not a Select: a type may print several.
    const values = w
      .findAllComponents({ name: 'MultiSelect' })
      .flatMap((sel) => ((sel.props('options') as { value: unknown }[] | undefined) ?? []))
      .map((o) => o.value);
    for (const template of PRINT_TEMPLATES) expect(values).toContain(template);

    await w.find('#dt-code').setValue('PR2');
    await w.find('#dt-name').setValue('Purchase Request');
    await w.find('form').trigger('submit');
    await flushPromises();
    await flushPromises();

    const payload = (cfg.createDocumentType as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][0] as { printTemplates: unknown };
    expect(payload.printTemplates).toEqual(['LETTER']);
  });

  it('shows the sheets a stored type prints when editing it', async () => {
    const w = await mountEdit([{ ...EXISTING, printTemplates: ['LETTER', 'RECEIPT'] }]);
    const cfg = useDocConfigStore();
    (cfg.updateDocumentType as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(true);

    await w.find('form').trigger('submit');
    await flushPromises();
    await flushPromises();

    const payload = (cfg.updateDocumentType as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][1] as { printTemplates: unknown };
    // Several sheets survive the round trip: one document can be several pieces of paper.
    expect(payload.printTemplates).toEqual(['LETTER', 'RECEIPT']);
  });

  // The column behind the sheets is comma-separated text, and a server that serialises the entity
  // raw sends that text rather than a list. The string used to reach the MultiSelect intact, which
  // rendered one empty chip per CHARACTER — six blank chips for 'LETTER' — and then failed the
  // array the schema demands, so the type could be opened and never saved.
  it('reads the sheets a server sent as comma-separated text', async () => {
    const w = await mountEdit([{ ...EXISTING, printTemplates: 'LETTER,RECEIPT' as unknown as string[] }]);
    const cfg = useDocConfigStore();
    (cfg.updateDocumentType as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(true);

    await w.find('form').trigger('submit');
    await flushPromises();
    await flushPromises();

    // The save goes through at all — the string failed the array schema, so the form refused every
    // submit and the store was never reached.
    expect(cfg.updateDocumentType).toHaveBeenCalledTimes(1);
    const payload = (cfg.updateDocumentType as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][1] as { printTemplates: unknown };
    expect(payload.printTemplates).toEqual(['LETTER', 'RECEIPT']);
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

  // zodResolver submits what the SCHEMA parsed, not the raw form values, and z.object strips what
  // it does not declare — so a field rendered on the form but missing from documentTypeSchema
  // reached the store as undefined and the toggle moved nothing. It was missing for this one.
  it('carries recordsPastEvents through the resolver when editing', async () => {
    const w = await mountEdit([{ ...EXISTING, recordsPastEvents: true }]);
    const cfg = useDocConfigStore();
    (cfg.updateDocumentType as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(true);

    await w.find('form').trigger('submit');
    await flushPromises();
    await flushPromises();

    const payload = (cfg.updateDocumentType as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][1] as { recordsPastEvents?: boolean };
    expect(payload.recordsPastEvents).toBe(true);
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

  // The same empty screen had two causes and one sentence. When the read that would have carried
  // the type failed, "no such type" sent the administrator hunting a type that exists — so a load
  // failure says what actually happened, and says it in the server's own words.
  it('blames the failed read rather than the type when the load errored', async () => {
    const w = await mountEdit([], 'workflows unavailable');
    await flushPromises();

    expect(w.find('[data-testid="type-load-failed"]').text()).toContain('workflows unavailable');
    expect(w.find('[data-testid="type-not-found"]').exists()).toBe(false);
    expect(w.find('form').exists()).toBe(false);
  });
});
