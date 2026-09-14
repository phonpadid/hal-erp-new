import { flushPromises } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { mountView } from '../../../test/mountView';
import WorkflowStepCreateView from './WorkflowStepCreateView.vue';

/**
 * A step can let its approver re-code the account a line posts to. Same two things as the slip
 * requirement beside it: the setting is authorable and defaults to off, and — when the approver it
 * names holds no `DOC_LINE_RECODE` — the screen says so instead of saving a step whose allowance
 * reaches nobody.
 */
const WF_ID = '11111111-1111-4111-8111-111111111111';
const STEP_ID = '22222222-2222-4222-8222-222222222222';
const ROLE_ACCOUNTING = '33333333-3333-4333-8333-333333333333';
const ROLE_PLAIN = '44444444-4444-4444-8444-444444444444';
const FIELD = '[data-testid="allows-recode-field"]';
const HINT = '[data-testid="allows-recode-inert"]';

type Step = Record<string, unknown>;

async function mountStep(step?: Step) {
  return mountView(WorkflowStepCreateView, {
    path: step
      ? '/doc-config/workflows/:workflowId/steps/:stepId'
      : '/doc-config/workflows/:workflowId/steps/new',
    routeName: step ? 'workflow-step-edit' : 'workflow-step-create',
    routeParams: step ? { workflowId: WF_ID, stepId: STEP_ID } : { workflowId: WF_ID },
    permissions: ['WORKFLOW_MANAGE'],
    initialState: {
      docConfig: {
        workflows: [{ id: WF_ID, name: 'DISB', steps: step ? [{ id: STEP_ID, ...step }] : [] }],
        roles: [
          { id: ROLE_ACCOUNTING, code: 'ACCOUNTING', permissions: [{ code: 'DOC_LINE_RECODE' }] },
          { id: ROLE_PLAIN, code: 'DEPT_HEAD', permissions: [{ code: 'DOC_APPROVE' }] },
        ],
        users: [],
      },
      auth: { permissions: ['WORKFLOW_MANAGE'] },
    },
  });
}

const base = { stepNo: 1, approveMode: 'SEQUENTIAL', showSignatureOnPdf: true };

describe('the step editor offers the account-recode allowance', () => {
  it('offers the setting', async () => {
    const w = await mountStep();
    await flushPromises();
    expect(w.find(FIELD).exists()).toBe(true);
  });

  it('is off on a step that has never carried it', async () => {
    const w = await mountStep({ ...base, approverRoleId: ROLE_PLAIN });
    await flushPromises();
    expect(w.find(FIELD).find('input').element.checked).toBe(false);
    expect(w.find(HINT).exists()).toBe(false);
  });

  it('reflects a step that carries it', async () => {
    const w = await mountStep({ ...base, approverRoleId: ROLE_ACCOUNTING, allowsAccountRecode: true });
    await flushPromises();
    expect(w.find(FIELD).find('input').element.checked).toBe(true);
    expect(w.find(HINT).exists()).toBe(false);
  });

  it('states it when the approver role holds no DOC_LINE_RECODE', async () => {
    const w = await mountStep({ ...base, approverRoleId: ROLE_PLAIN, allowsAccountRecode: true });
    await flushPromises();
    expect(w.find(HINT).exists()).toBe(true);
    expect(w.find(HINT).attributes('data-reason')).toBe('approverRole');
  });

  it('says nothing while the allowance is off, whatever the role holds', async () => {
    const w = await mountStep({ ...base, approverRoleId: ROLE_PLAIN, allowsAccountRecode: false });
    await flushPromises();
    expect(w.find(HINT).exists()).toBe(false);
  });

  it('does not guess for a named person', async () => {
    const w = await mountStep({ ...base, approverUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', allowsAccountRecode: true });
    await flushPromises();
    expect(w.find(HINT).exists()).toBe(false);
  });
});
