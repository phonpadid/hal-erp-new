import { flushPromises } from '@vue/test-utils';
import ToggleSwitch from 'primevue/toggleswitch';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../../i18n';
import { mountView } from '../../../test/mountView';
import { useDocConfigStore } from '../../../stores/docConfig';
import WorkflowsView from './WorkflowsView.vue';

// The ConfirmDialog is mounted by the app shell, not this isolated harness; auto-accept.
const { confirmMock } = vi.hoisted(() => ({ confirmMock: vi.fn(() => Promise.resolve(true)) }));
vi.mock('../../../composables/useFeedback', () => ({
  useFeedback: () => ({ success: vi.fn(), error: vi.fn(), confirm: confirmMock }),
}));

beforeAll(() => { i18n.global.locale.value = 'en'; });
afterAll(() => { i18n.global.locale.value = 'la'; });

const WORKFLOWS = [
  { id: 'wf-1', name: 'Standard Approval', isActive: true, steps: [{ id: 's1', stepNo: 1, approveMode: 'SEQUENTIAL' }, { id: 's2', stepNo: 2, approveMode: 'SEQUENTIAL' }] },
  { id: 'wf-2', name: 'Empty', isActive: false, steps: [] },
];

async function mount() {
  const w = await mountView(WorkflowsView, {
    path: '/doc-config/workflows',
    routeName: 'doc-config-workflows',
    permissions: ['DOC_CONFIG_MANAGE', 'WORKFLOW_MANAGE'],
    initialState: { docConfig: { workflows: WORKFLOWS, documentTypes: [{ id: 'd1' }] } },
  });
  await flushPromises();
  return w;
}

describe('WorkflowsView list', () => {
  it('shows a compact step count per row instead of wrapping chips', async () => {
    const w = await mount();
    const text = w.text();
    expect(text).toContain('2 steps');
    expect(text).toContain('No steps');
  });

  it('renders an active ToggleSwitch per row and toggles via the store', async () => {
    const w = await mount();
    const cfg = useDocConfigStore();
    const switches = w.findAllComponents(ToggleSwitch);
    expect(switches.length).toBe(2);
    // Flip the first (active) workflow off.
    await switches[0].vm.$emit('update:modelValue', false);
    await flushPromises();
    expect(cfg.updateWorkflow).toHaveBeenCalledWith('wf-1', { isActive: false });
  });

  it('deletes a workflow after confirmation', async () => {
    const w = await mount();
    const cfg = useDocConfigStore();
    confirmMock.mockClear();
    const delBtn = w.find('.p-datatable-tbody .pi-trash');
    expect(delBtn.exists()).toBe(true);
    await delBtn.trigger('click');
    await flushPromises();
    expect(confirmMock).toHaveBeenCalled();
    expect(cfg.deleteWorkflow).toHaveBeenCalledWith('wf-1');
  });
});
