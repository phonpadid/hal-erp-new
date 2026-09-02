import { flushPromises } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { mountView } from '../../../test/mountView';
import { useDocConfigStore } from '../../../stores/docConfig';
import WorkflowStepCreateView from './WorkflowStepCreateView.vue';

// A valid UUID so workflowStepSchema (workflowId: uuid) passes with just the initial values.
const WF_ID = '11111111-1111-4111-8111-111111111111';
const ROLE_ID = '33333333-3333-4333-8333-333333333333';

/**
 * Name the approver the schema now requires — a step without one is a shape that cannot ship.
 *
 * Found by its test id, not by what it displays: the form labels a role by whichever of its name
 * and code an admin reads it by, so `optionLabel` is a presentation decision and was never a
 * locator — the day it changed, this helper stopped finding the Select at all.
 */
async function nameRole(w: { findAllComponents: (s: { name: string }) => Array<{ attributes: (a: string) => string | undefined; vm: unknown }> }) {
  const select = w.findAllComponents({ name: 'Select' }).find((c) => c.attributes('data-testid') === 'approver-role');
  if (!select) throw new Error('no approver-role Select on the form');
  (select.vm as { writeValue: (v: unknown) => void }).writeValue(ROLE_ID);
  await flushPromises();
}

describe('WorkflowStepCreateView', () => {
  it('submits the step to addStep, reading values from the form states', async () => {
    const w = await mountView(WorkflowStepCreateView, {
      path: '/doc-config/workflows/:workflowId/steps/new',
      routeName: 'workflow-step-create',
      routeParams: { workflowId: WF_ID },
      initialState: {
        docConfig: {
          workflows: [{ id: WF_ID, name: 'PR', steps: [] }],
          roles: [{ id: ROLE_ID, code: 'APPROVER' }],
          users: [],
        },
      },
    });
    const cfg = useDocConfigStore();

    // Submit with the form's initial values (workflowId + stepNo:1 + approveMode:SEQUENTIAL) plus
    // the approver the schema requires. This is the exact path that previously threw on `e.values`
    // being undefined.
    await nameRole(w);
    await w.find('form').trigger('submit');
    await flushPromises();
    await flushPromises();

    expect(cfg.addStep).toHaveBeenCalledTimes(1);
    const payload = (cfg.addStep as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0];
    // The signature toggle defaults on and is carried through the submit.
    expect(payload).toMatchObject({ workflowId: WF_ID, stepNo: 1, approveMode: 'SEQUENTIAL', showSignatureOnPdf: true, approverRoleId: ROLE_ID });
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
              approverRoleId: ROLE_ID,
              conditionJson: '{"minRank":30}',
            }],
          }],
          roles: [{ id: ROLE_ID, code: 'APPROVER' }], users: [],
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
