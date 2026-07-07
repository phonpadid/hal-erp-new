import { flushPromises } from '@vue/test-utils';
import ToggleSwitch from 'primevue/toggleswitch';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../../i18n';
import { mountView } from '../../../test/mountView';
import { useDocConfigStore } from '../../../stores/docConfig';
import WorkflowDetailView from './WorkflowDetailView.vue';

// The destructive-action ConfirmDialog is mounted by the app shell, not this isolated
// view harness, so stub useFeedback with a confirm that auto-accepts.
const { confirmMock } = vi.hoisted(() => ({ confirmMock: vi.fn(() => Promise.resolve(true)) }));
vi.mock('../../../composables/useFeedback', () => ({
  useFeedback: () => ({ success: vi.fn(), error: vi.fn(), confirm: confirmMock }),
}));

// Assert on the English catalog so label checks are readable; `la` is the app default.
beforeAll(() => { i18n.global.locale.value = 'en'; });
afterAll(() => { i18n.global.locale.value = 'la'; });

const WF_ID = '11111111-1111-4111-8111-111111111111';

const WORKFLOW = {
  id: WF_ID,
  name: 'Standard Approval',
  isActive: true,
  conditionJson: JSON.stringify({ jobLevels: ['MANAGER'], amountMin: '0', amountMax: '50000' }),
  steps: [
    {
      id: 'step-1',
      stepNo: 1,
      stepName: 'Manager review',
      approverRoleId: 'role-1',
      approveMode: 'SEQUENTIAL',
      amountMin: '0',
      amountMax: '10000',
      slaHours: 24,
      conditionJson: JSON.stringify({ jobLevels: ['STAFF'] }),
    },
  ],
};

async function mount(initialState: Record<string, unknown>) {
  const w = await mountView(WorkflowDetailView, {
    path: '/doc-config/workflows/:workflowId',
    routeName: 'doc-config-workflow-detail',
    routeParams: { workflowId: WF_ID },
    permissions: ['DOC_CONFIG_MANAGE', 'WORKFLOW_MANAGE'],
    initialState: { docConfig: initialState },
  });
  await flushPromises();
  return w;
}

describe('WorkflowDetailView', () => {
  it('renders the workflow header, selection condition, and its steps in full', async () => {
    const w = await mount({
      workflows: [WORKFLOW],
      roles: [{ id: 'role-1', code: 'DEPT_HEAD' }],
      users: [],
    });

    const text = w.text();
    expect(text).toContain('Standard Approval');
    // Step row shows number, name, resolved approver (role code), mode, band, SLA.
    expect(text).toContain('Manager review');
    expect(text).toContain('DEPT_HEAD');
    // Mode renders the i18n label for the SEQUENTIAL approve mode, not the raw enum.
    expect(text).toContain('Sequential');
    expect(text).toContain('24h');
    // Workflow-level job level from conditionJson.
    expect(text).toContain('MANAGER');
  });

  it('loads workflows on mount when the store is empty (deep link)', async () => {
    const w = await mount({ workflows: [], roles: [], users: [] });
    const cfg = useDocConfigStore();
    expect(cfg.loadAll).toHaveBeenCalled();
    void w;
  });

  it('shows a not-found state for an unknown workflow id once loading settles', async () => {
    const other = { ...WORKFLOW, id: 'other-id' };
    const w = await mount({ workflows: [other], roles: [], users: [] });
    expect(w.text()).toContain('Workflow not found');
  });

  it('navigates to the step-create page when Add step is clicked', async () => {
    const w = await mount({ workflows: [WORKFLOW], roles: [], users: [] });
    const push = vi.spyOn(w.vm.$router, 'push').mockResolvedValue(undefined as never);
    const addBtn = w
      .findAll('button')
      .find((b) => b.text().includes('Add step'));
    expect(addBtn).toBeTruthy();
    await addBtn!.trigger('click');
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'workflow-step-create', params: { workflowId: WF_ID } }),
    );
  });

  it('toggles the workflow active state via the toolbar switch', async () => {
    const w = await mount({ workflows: [WORKFLOW], roles: [], users: [] });
    const cfg = useDocConfigStore();
    const toggle = w.findComponent(ToggleSwitch);
    expect(toggle.exists()).toBe(true);
    await toggle.vm.$emit('update:modelValue', false);
    await flushPromises();
    expect(cfg.updateWorkflow).toHaveBeenCalledWith(WF_ID, { isActive: false });
  });

  it('navigates to the step-edit page from a step row action', async () => {
    const w = await mount({ workflows: [WORKFLOW], roles: [], users: [] });
    const push = vi.spyOn(w.vm.$router, 'push').mockResolvedValue(undefined as never);
    // The step row's pencil action edits that step.
    const editBtn = w.find('.p-datatable-tbody .pi-pencil');
    expect(editBtn.exists()).toBe(true);
    await editBtn.trigger('click');
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'workflow-step-edit', params: { workflowId: WF_ID, stepId: 'step-1' } }),
    );
  });

  it('deletes a step after confirmation', async () => {
    const w = await mount({ workflows: [WORKFLOW], roles: [], users: [] });
    const cfg = useDocConfigStore();
    confirmMock.mockClear();
    const delBtn = w.find('.p-datatable-tbody .pi-trash');
    expect(delBtn.exists()).toBe(true);
    await delBtn.trigger('click');
    await flushPromises();
    expect(confirmMock).toHaveBeenCalled();
    expect(cfg.deleteStep).toHaveBeenCalledWith('step-1');
  });

  it('deletes the workflow and returns to the list after confirmation', async () => {
    const w = await mount({ workflows: [WORKFLOW], roles: [], users: [] });
    const cfg = useDocConfigStore();
    // Stubbed store actions resolve undefined; make delete succeed so the view navigates.
    (cfg.deleteWorkflow as unknown as { mockResolvedValue: (v: boolean) => void }).mockResolvedValue(true);
    const push = vi.spyOn(w.vm.$router, 'push').mockResolvedValue(undefined as never);
    confirmMock.mockClear();
    const delBtn = w.findAll('button').find((b) => b.text().includes('Delete'));
    expect(delBtn).toBeTruthy();
    await delBtn!.trigger('click');
    await flushPromises();
    expect(cfg.deleteWorkflow).toHaveBeenCalledWith(WF_ID);
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ name: 'doc-config-workflows' }));
  });
});
