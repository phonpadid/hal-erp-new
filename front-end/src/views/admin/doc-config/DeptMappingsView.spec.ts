import { flushPromises } from '@vue/test-utils';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../../i18n';
import { mountView } from '../../../test/mountView';
import { useDocConfigStore } from '../../../stores/docConfig';
import DeptMappingsView from './DeptMappingsView.vue';

vi.mock('../../../composables/useFeedback', () => ({
  useFeedback: () => ({ success: vi.fn(), error: vi.fn(), confirm: vi.fn(() => Promise.resolve(true)) }),
}));

beforeAll(() => { i18n.global.locale.value = 'en'; });
afterAll(() => { i18n.global.locale.value = 'la'; });

const WF_A = '11111111-1111-4111-8111-111111111111';
const WF_B = '22222222-2222-4222-8222-222222222222';
const TMPL = '33333333-3333-4333-8333-333333333333';

const MAPPINGS = [
  {
    id: 'map-1', departmentId: 'd1', departmentName: 'Procurement',
    documentTypeId: 't1', documentTypeCode: 'PR',
    formTemplateId: TMPL, templateVersion: 1,
    workflowId: WF_A, workflowName: 'Standard Approval', isActive: true,
  },
];

async function mount() {
  const w = await mountView(DeptMappingsView, {
    path: '/doc-config/mappings',
    routeName: 'doc-config-mappings',
    permissions: ['DOC_CONFIG_MANAGE'],
    initialState: {
      docConfig: {
        mappings: MAPPINGS,
        mappingsTotal: 1,
        documentTypes: [{ id: 't1', code: 'PR' }],
        workflows: [
          { id: WF_A, name: 'Standard Approval', isActive: true, steps: [] },
          { id: WF_B, name: 'Full Approval Chain', isActive: true, steps: [] },
        ],
        templatesByType: { t1: [{ id: TMPL, version: 1, status: 'PUBLISHED' }] },
      },
    },
  });
  await flushPromises();
  return w;
}

describe('DeptMappingsView edit', () => {
  it('renders an edit affordance per mapping row', async () => {
    const w = await mount();
    expect(w.find('.p-datatable-tbody .pi-pencil').exists()).toBe(true);
  });

  it('opens the prefilled edit dialog and submits changes to updateMapping', async () => {
    const w = await mount();
    const cfg = useDocConfigStore();

    await w.find('.p-datatable-tbody .pi-pencil').trigger('click');
    await flushPromises();

    // The Dialog teleports to body; assert on the document.
    const body = document.body.textContent ?? '';
    expect(body).toContain('Procurement'); // fixed department shown read-only
    expect(body).toContain('created afterward'); // future-documents note

    // Submit the edit form with its prefilled (valid) values.
    const form = document.body.querySelector('form');
    expect(form).toBeTruthy();
    form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();
    await flushPromises();

    expect(cfg.updateMapping).toHaveBeenCalledTimes(1);
    const [id, payload] = (cfg.updateMapping as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(id).toBe('map-1');
    // Active is toggled inline in the table now, not in the edit form: the form submits
    // only template + workflow and no longer carries isActive.
    expect(payload).toMatchObject({ workflowId: WF_A, formTemplateId: TMPL });
    expect(payload).not.toHaveProperty('isActive');
  });
});
