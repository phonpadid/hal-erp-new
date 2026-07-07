import { config, flushPromises } from '@vue/test-utils';
import Select from 'primevue/select';
import { afterAll, describe, expect, it } from 'vitest';
import { mountView } from '../../../test/mountView';

// Render the field-builder Dialog inline instead of teleporting it to <body>, so the
// dialog's <form> is reachable from the mounted wrapper. Tests run under the default
// 'la' locale, so assertions target data (field names, the status enum) not UI copy.
const priorStubs = config.global.stubs;
config.global.stubs = { ...(priorStubs as object), teleport: true };
afterAll(() => { config.global.stubs = priorStubs; });
import { useDocConfigStore } from '../../../stores/docConfig';
import type { FormFieldRow, TemplateSummary } from '../../../api/docConfig';
import FormTemplatesView from './FormTemplatesView.vue';

const TYPE = { id: 'type-1', code: 'PR', name: 'Purchase Req', category: 'PROCUREMENT', requiresBudget: true, requiresQuota: false, requiresVendor: true, isActive: true };
const DRAFT: TemplateSummary = { id: 'tpl-1', version: 1, status: 'DRAFT', fieldCount: 2 };
const PUBLISHED: TemplateSummary = { id: 'tpl-2', version: 2, status: 'PUBLISHED', fieldCount: 2 };
const FIELDS: FormFieldRow[] = [
  { id: 'f1', fieldName: 'amount', fieldLabel: 'Amount', fieldType: 'number', isRequired: true, sortOrder: 0 },
  { id: 'f2', fieldName: 'note', fieldLabel: 'Note', fieldType: 'text', isRequired: false, sortOrder: 1 },
];

async function mount(templates: TemplateSummary[] = [DRAFT]) {
  const w = await mountView(FormTemplatesView, {
    path: '/doc-config/forms',
    routeName: 'doc-config-forms',
    permissions: ['DOC_CONFIG_MANAGE'],
    initialState: {
      docConfig: {
        documentTypes: [TYPE],
        templatesByType: { 'type-1': templates },
        fieldsByTemplate: { 'tpl-1': FIELDS, 'tpl-2': FIELDS },
      },
    },
  });
  await flushPromises();
  return w;
}

// Choose the document type via the toolbar Select (the only Select while the dialog is closed).
async function chooseType(w: Awaited<ReturnType<typeof mount>>) {
  await w.findComponent(Select).vm.$emit('update:modelValue', 'type-1');
  await flushPromises();
}
// Click a version card by its "v{n}" label.
async function chooseVersion(w: Awaited<ReturnType<typeof mount>>, label: string) {
  const btn = w.findAll('button').find((b) => b.text().includes(label));
  await btn!.trigger('click');
  await flushPromises();
}
const fieldRowNames = (w: Awaited<ReturnType<typeof mount>>) =>
  w.findAll('.p-datatable-tbody > tr').map((r) => r.findAll('td')[1]?.text() ?? '').filter(Boolean);

describe('FormTemplatesView', () => {
  it('loads and lists a version\'s fields when it is selected', async () => {
    const w = await mount();
    await chooseType(w);
    const cfg = useDocConfigStore();
    await chooseVersion(w, 'v1');
    expect(cfg.loadFields).toHaveBeenCalledWith('tpl-1');
    expect(fieldRowNames(w)).toEqual(['amount', 'note']);
  });

  it('edits a field via updateField without sending the immutable fieldName', async () => {
    const w = await mount();
    await chooseType(w);
    await chooseVersion(w, 'v1');
    const cfg = useDocConfigStore();
    // Open the edit dialog for the first field (pencil button) and submit its pre-filled values.
    const pencil = w.findAll('button').find((b) => b.find('.pi-pencil').exists());
    await pencil!.trigger('click');
    await flushPromises();
    await w.find('form').trigger('submit');
    await flushPromises();
    await flushPromises();
    expect(cfg.updateField).toHaveBeenCalled();
    const [id, dto] = (cfg.updateField as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)!;
    expect(id).toBe('f1');
    // fieldName is immutable server-side, so it must not be sent; the editable fields are.
    expect(dto).not.toHaveProperty('fieldName');
    expect(dto).toMatchObject({ fieldLabel: 'Amount', fieldType: 'number' });
  });

  it('hides add/edit/reorder affordances for a published template', async () => {
    const w = await mount([PUBLISHED]);
    await chooseType(w);
    await chooseVersion(w, 'v2');
    // No per-row edit pencil, no reorder arrows — the template is locked.
    expect(w.find('.pi-pencil').exists()).toBe(false);
    expect(w.find('.pi-arrow-up').exists()).toBe(false);
    // The locked tag (with its lock icon) is shown instead; status enum is data, not UI copy.
    expect(w.find('.pi-lock').exists()).toBe(true);
    expect(w.text()).toContain('PUBLISHED');
  });
});
