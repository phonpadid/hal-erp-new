import { flushPromises } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { mountView } from '../../../test/mountView';
import { useDocConfigStore } from '../../../stores/docConfig';
import WorkflowStepCreateView from './WorkflowStepCreateView.vue';

// A valid UUID so workflowStepSchema (workflowId: uuid) passes with just the initial values.
const WF_ID = '11111111-1111-4111-8111-111111111111';

describe('WorkflowStepCreateView', () => {
  it('submits the step to addStep, reading values from the form states', async () => {
    const w = await mountView(WorkflowStepCreateView, {
      path: '/doc-config/workflows/:workflowId/steps/new',
      routeName: 'workflow-step-create',
      routeParams: { workflowId: WF_ID },
      initialState: {
        docConfig: { workflows: [{ id: WF_ID, name: 'PR', steps: [] }], roles: [], users: [] },
      },
    });
    const cfg = useDocConfigStore();

    // Submit with the form's initial values (workflowId + stepNo:1 + approveMode:SEQUENTIAL) —
    // enough to be valid. This is the exact path that previously threw on `e.values` being undefined.
    await w.find('form').trigger('submit');
    await flushPromises();
    await flushPromises();

    expect(cfg.addStep).toHaveBeenCalledTimes(1);
    const payload = (cfg.addStep as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0];
    // The signature toggle defaults on and is carried through the submit.
    expect(payload).toMatchObject({ workflowId: WF_ID, stepNo: 1, approveMode: 'SEQUENTIAL', showSignatureOnPdf: true });
  });

  it('round-trips a minRank step condition through edit (parse → serialize)', async () => {
    const STEP_ID = '22222222-2222-4222-8222-222222222222';
    const w = await mountView(WorkflowStepCreateView, {
      path: '/doc-config/workflows/:workflowId/steps/:stepId',
      routeName: 'workflow-step-edit',
      routeParams: { workflowId: WF_ID, stepId: STEP_ID },
      initialState: {
        docConfig: {
          workflows: [{
            id: WF_ID, name: 'PR', steps: [{
              id: STEP_ID, stepNo: 2, approveMode: 'SEQUENTIAL', showSignatureOnPdf: true,
              conditionJson: '{"minRank":30}',
            }],
          }],
          roles: [], users: [],
          jobLevels: [{ id: 'l1', code: 'MANAGER', name: 'Manager', rank: 30 }],
        },
      },
    });
    const cfg = useDocConfigStore();

    await w.find('form').trigger('submit');
    await flushPromises();
    await flushPromises();

    expect(cfg.updateStep).toHaveBeenCalledTimes(1);
    const payload = (cfg.updateStep as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1] as { conditionJson?: string };
    // The editor seeded minRank mode from the existing condition and re-serialized it unchanged.
    expect(payload.conditionJson).toBe('{"minRank":30}');
  });

  it('hides the signature toggle without the workflow-config permission', async () => {
    const w = await mountView(WorkflowStepCreateView, {
      path: '/doc-config/workflows/:workflowId/steps/new',
      routeName: 'workflow-step-create',
      routeParams: { workflowId: WF_ID },
      permissions: [], // no WORKFLOW_MANAGE
      initialState: {
        docConfig: { workflows: [{ id: WF_ID, name: 'PR', steps: [] }], roles: [], users: [] },
      },
    });
    // v-can hides via display:none (UX-only gate) rather than unmounting.
    expect(w.find('[data-testid="show-signature-field"]').isVisible()).toBe(false);
  });
});
