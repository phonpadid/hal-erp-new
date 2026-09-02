import { flushPromises } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { useDocConfigStore } from '../../../stores/docConfig';
import { mountView } from '../../../test/mountView';
import WorkflowStepCreateView from './WorkflowStepCreateView.vue';

/**
 * A step naming neither a role nor a person opens with zero actors and leaves the document in
 * nobody's queue, so the schema refuses it. The screen said NOTHING about that refusal: Add was
 * pressed, nothing moved, and no field was marked.
 *
 * Three separate faults produced that one silence, and each is pinned here:
 *
 *  1. `workflowId` is a route param with no FormField, so it never reached the resolver. Zod failed
 *     the base shape on it, and a failed base shape skips `.superRefine()` — the approver rule and
 *     the amountMin/amountMax rule were both dead on the client, while the form still reported
 *     itself VALID because validity counts only registered fields.
 *  2. `stepNo` arrives from InputNumber as a string on the first pass, and the resulting transient
 *     type error rendered a Message that shifted the layout out from under the pointer, so the
 *     press never became a click.
 *  3. Nothing rendered the rule.
 *
 * These assert the RENDERED statement and whether the store was called, because every one of those
 * faults left a correct-looking function behind a screen that did nothing.
 */
const WF_ID = '11111111-1111-4111-8111-111111111111';
const ROLE_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const STATEMENT = '[data-testid="approver-required"]';

async function mountStep() {
  return mountView(WorkflowStepCreateView, {
    path: '/doc-config/workflows/:workflowId/steps/new',
    routeName: 'workflow-step-create',
    routeParams: { workflowId: WF_ID },
    extraRoutes: [{ path: '/doc-config/workflows/:workflowId', name: 'doc-config-workflow-detail' }],
    initialState: {
      docConfig: {
        workflows: [{ id: WF_ID, name: 'PR', steps: [] }],
        roles: [{ id: ROLE_ID, code: 'APPROVER' }],
        users: [{ id: USER_ID, username: 'approver' }],
      },
    },
  });
}

/**
 * Name an approver on the nth approver Select. A FormField drives its child through the handlers it
 * injects, not through `modelValue`, so setting the prop would leave the form state untouched —
 * emit the update the real widget emits.
 */
async function nameApprover(w: Awaited<ReturnType<typeof mountStep>>, by: 'role' | 'person', id: string) {
  // Found by what it IS rather than by position: the form holds several Selects and the order is a
  // layout decision, not a contract. The role half is found by its test id — it used to be found by
  // `optionLabel`, which is how a role is DISPLAYED, and renaming that label to the one an admin
  // reads left this helper finding nothing.
  const select = w
    .findAllComponents({ name: 'Select' })
    .find((s) => (by === 'role'
      ? s.attributes('data-testid') === 'approver-role'
      : s.props('optionLabel') === 'username'));
  if (!select) throw new Error(`no ${by} Select on the form`);
  (select.vm as unknown as { writeValue: (v: unknown, e?: Event) => void }).writeValue(id);
  await flushPromises();
}

/** Press Add once, the way a user does. */
async function add(w: Awaited<ReturnType<typeof mountStep>>) {
  await w.find('form').trigger('submit');
  await flushPromises();
}

describe('a step that names no approver says so', () => {
  it('says nothing before Add is pressed', async () => {
    const w = await mountStep();
    await flushPromises();
    expect(w.find(STATEMENT).exists()).toBe(false);
  });

  it('states the rule on the FIRST press, and does not call the server', async () => {
    const w = await mountStep();
    await flushPromises();
    const cfg = useDocConfigStore();

    await add(w);

    expect(w.find(STATEMENT).exists()).toBe(true);
    // A translated sentence, not a leaked key — the parity spec holds the three locales together.
    const text = w.find(STATEMENT).text();
    expect(text.length).toBeGreaterThan(10);
    expect(text).not.toContain('approverRequired');
    expect(cfg.addStep).not.toHaveBeenCalled();
  });

  it('still states it when a step number was typed first', async () => {
    // The ordinary order of work, and the one that used to swallow the press entirely: InputNumber
    // hands the resolver a STRING, whose transient type error moved the button mid-click.
    const w = await mountStep();
    await flushPromises();
    const cfg = useDocConfigStore();

    await w.find('input').setValue('9');
    await flushPromises();
    await add(w);

    expect(w.find(STATEMENT).exists()).toBe(true);
    expect(cfg.addStep).not.toHaveBeenCalled();
  });

  it('stops stating it once a role is named, and saves', async () => {
    const w = await mountStep();
    await flushPromises();
    const cfg = useDocConfigStore();

    await add(w);
    expect(w.find(STATEMENT).exists()).toBe(true);

    await nameApprover(w, 'role', ROLE_ID);

    expect(w.find(STATEMENT).exists()).toBe(false);
    await add(w);
    expect(cfg.addStep).toHaveBeenCalledTimes(1);
  });

  it('accepts a specific person INSTEAD of a role', async () => {
    // The rule is on the pair; a step may name either one.
    const w = await mountStep();
    await flushPromises();
    const cfg = useDocConfigStore();

    await add(w);
    expect(w.find(STATEMENT).exists()).toBe(true);

    await nameApprover(w, 'person', USER_ID);

    expect(w.find(STATEMENT).exists()).toBe(false);
    await add(w);
    expect(cfg.addStep).toHaveBeenCalledTimes(1);
  });
});

describe('the other rule the same fault had killed', () => {
  it('refuses an amount band that runs backwards', async () => {
    // Lives in the same superRefine as the approver rule, so it was equally dead while
    // `workflowId` was missing from the values — and equally invisible.
    const w = await mountStep();
    await flushPromises();
    const cfg = useDocConfigStore();

    await nameApprover(w, 'role', ROLE_ID);
    const amounts = w.findAll('input[inputmode="decimal"]');
    await amounts[0].setValue('500');
    await amounts[1].setValue('100');
    await flushPromises();

    await add(w);

    expect(cfg.addStep).not.toHaveBeenCalled();
  });
});
