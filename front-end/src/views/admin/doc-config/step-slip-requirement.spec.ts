import { flushPromises } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { mountView } from '../../../test/mountView';
import WorkflowStepCreateView from './WorkflowStepCreateView.vue';

/**
 * A step can demand a transfer slip before it may be approved. Two things have to be true on the
 * screen: the setting is authorable and defaults to off, and — when the approver it names could
 * never satisfy it — the screen says so instead of saving a step that can only be rejected.
 *
 * The hint reports rather than refuses: `PAYMENT_MANAGE` can be granted afterwards, and "somebody
 * else uploads, this person only signs off" is a real arrangement.
 */
const WF_ID = '11111111-1111-4111-8111-111111111111';
const STEP_ID = '22222222-2222-4222-8222-222222222222';
const ROLE_PAYER = '33333333-3333-4333-8333-333333333333';
const ROLE_PLAIN = '44444444-4444-4444-8444-444444444444';
const FIELD = '[data-testid="requires-slip-field"]';
const HINT = '[data-testid="requires-slip-inert"]';

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
        workflows: [{ id: WF_ID, name: 'PR', steps: step ? [{ id: STEP_ID, ...step }] : [] }],
        roles: [
          { id: ROLE_PAYER, code: 'FINANCE', permissions: [{ code: 'PAYMENT_MANAGE' }] },
          { id: ROLE_PLAIN, code: 'DEPT_HEAD', permissions: [{ code: 'DOC_APPROVE' }] },
        ],
        users: [],
      },
      auth: { permissions: ['WORKFLOW_MANAGE'] },
    },
  });
}

const base = { stepNo: 1, approveMode: 'SEQUENTIAL', showSignatureOnPdf: true };

describe('the step editor offers the transfer-slip requirement', () => {
  it('offers the setting', async () => {
    const w = await mountStep();
    await flushPromises();
    expect(w.find(FIELD).exists()).toBe(true);
  });

  it('is off on a step that has never carried it', async () => {
    // Every step demanded nothing before this setting existed; a step nobody configured must keep
    // demanding nothing.
    const w = await mountStep({ ...base, approverRoleId: ROLE_PLAIN });
    await flushPromises();
    expect(w.find(FIELD).find('input').element.checked).toBe(false);
    expect(w.find(HINT).exists()).toBe(false);
  });

  it('reflects a step that carries it', async () => {
    const w = await mountStep({ ...base, approverRoleId: ROLE_PAYER, requiresPaymentSlip: true });
    await flushPromises();
    expect(w.find(FIELD).find('input').element.checked).toBe(true);
  });

  it('says nothing when the approver role can attach a slip', async () => {
    const w = await mountStep({ ...base, approverRoleId: ROLE_PAYER, requiresPaymentSlip: true });
    await flushPromises();
    expect(w.find(HINT).exists()).toBe(false);
  });

  it('states it when the approver role holds no PAYMENT_MANAGE', async () => {
    const w = await mountStep({ ...base, approverRoleId: ROLE_PLAIN, requiresPaymentSlip: true });
    await flushPromises();
    expect(w.find(HINT).exists()).toBe(true);
    expect(w.find(HINT).attributes('data-reason')).toBe('approverRole');
  });

  it('says nothing while the requirement is off, whatever the role holds', async () => {
    // The hint is about a consequence of the setting. With the setting off there is no consequence.
    const w = await mountStep({ ...base, approverRoleId: ROLE_PLAIN, requiresPaymentSlip: false });
    await flushPromises();
    expect(w.find(HINT).exists()).toBe(false);
  });

  it('does not guess for a named person, whose codes the picker does not carry', async () => {
    // `/rbac/users` returns assignment ids, not role ids, so a person's effective permissions
    // cannot be resolved here. Staying quiet beats guessing; the server enforces regardless.
    const w = await mountStep({ ...base, approverUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', requiresPaymentSlip: true });
    await flushPromises();
    expect(w.find(HINT).exists()).toBe(false);
  });
});
