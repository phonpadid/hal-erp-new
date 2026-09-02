import { flushPromises } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { mountView } from '../../../test/mountView';
import WorkflowStepCreateView from './WorkflowStepCreateView.vue';

/**
 * An escalation target is read only when a step goes overdue. A step with no SLA never is (the
 * server tests `!step.slaHours`), and a PARALLEL_ALL step declines escalation outright — one
 * stand-in cannot answer for a committee. Either way the target saves and is never used.
 *
 * These assert the rendered statement, not the function behind it: a computed can be right while
 * the template still binds the wrong thing.
 */
const WF_ID = '11111111-1111-4111-8111-111111111111';
const STEP_ID = '22222222-2222-4222-8222-222222222222';
const HINT = '[data-testid="escalation-inert"]';

type Step = Record<string, unknown>;

async function mountStep(step?: Step) {
  return mountView(WorkflowStepCreateView, {
    path: step
      ? '/doc-config/workflows/:workflowId/steps/:stepId'
      : '/doc-config/workflows/:workflowId/steps/new',
    routeName: step ? 'workflow-step-edit' : 'workflow-step-create',
    routeParams: step ? { workflowId: WF_ID, stepId: STEP_ID } : { workflowId: WF_ID },
    initialState: {
      docConfig: {
        workflows: [{ id: WF_ID, name: 'PR', steps: step ? [{ id: STEP_ID, ...step }] : [] }],
        roles: [], users: [],
      },
    },
  });
}

describe('a step says when its escalation target cannot fire', () => {
  it('states the missing SLA on a new step', async () => {
    const w = await mountStep();
    await flushPromises();
    expect(w.find(HINT).exists()).toBe(true);
    expect(w.find(HINT).attributes('data-reason')).toBe('noSla');
    // Names the prerequisite, so the reader knows what to change. In Lao, not as the bare
    // English acronym it used to be.
    expect(w.find(HINT).text()).toContain('ກຳນົດເວລາ');
    expect(w.find(HINT).text()).not.toContain('SLA');
  });

  it('says nothing once the step has an SLA', async () => {
    const w = await mountStep({ stepNo: 1, approveMode: 'SEQUENTIAL', slaHours: 24, showSignatureOnPdf: true });
    await flushPromises();
    expect(w.find(HINT).exists()).toBe(false);
  });

  it('treats zero hours as no SLA, exactly as the server does', async () => {
    // sla.service tests `!step.slaHours`, so a zero never makes a step overdue either.
    const w = await mountStep({ stepNo: 1, approveMode: 'SEQUENTIAL', slaHours: 0, showSignatureOnPdf: true });
    await flushPromises();
    expect(w.find(HINT).attributes('data-reason')).toBe('noSla');
  });

  it('states the mode on a PARALLEL_ALL step that does have an SLA', async () => {
    const w = await mountStep({ stepNo: 1, approveMode: 'PARALLEL_ALL', slaHours: 24, showSignatureOnPdf: true });
    await flushPromises();
    expect(w.find(HINT).exists()).toBe(true);
    expect(w.find(HINT).attributes('data-reason')).toBe('mode');
  });

  it('reports the missing SLA first when both are true', async () => {
    // Setting the SLA alone would not make this one escalate, but it is the nearer of the two and
    // the mode statement appears the moment it is fixed.
    const w = await mountStep({ stepNo: 1, approveMode: 'PARALLEL_ALL', showSignatureOnPdf: true });
    await flushPromises();
    expect(w.find(HINT).attributes('data-reason')).toBe('noSla');
  });

  it('leaves the escalation fields usable while the statement is shown', async () => {
    // Naming the stand-in and setting the deadline afterwards is a reasonable order of work.
    const w = await mountStep();
    await flushPromises();
    expect(w.find(HINT).exists()).toBe(true);
    const inputs = w.findAll('input');
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.every((i) => i.attributes('disabled') === undefined)).toBe(true);
  });
});
