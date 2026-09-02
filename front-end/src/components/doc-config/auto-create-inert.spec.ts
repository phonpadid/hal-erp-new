import { flushPromises, mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import Tooltip from 'primevue/tooltip';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import type { DocType } from '../../api/docConfig';
import RefChainEditor from './RefChainEditor.vue';

const refPairings = vi.fn();
const departments = vi.fn();

vi.mock('../../api/docConfig', () => ({
  docConfigApi: {
    refPairings: (...a: unknown[]) => refPairings(...a),
    addRefPairing: vi.fn(),
    updateRefPairing: vi.fn(),
    removeRefPairing: vi.fn(),
    departments: (...a: unknown[]) => departments(...a),
  },
}));

vi.mock('../../composables/useFeedback', () => ({
  useFeedback: () => ({ success: vi.fn(), error: vi.fn(), confirm: vi.fn(() => Promise.resolve(true)) }),
}));

/**
 * `auto_create` is read on exactly one path — the create-successor branch of the post-action
 * dispatcher. Ticked on a predecessor whose post-action is anything else, the flag saves and is
 * never read again. Nothing refuses it, because nothing is harmed; the screen is where the
 * administrator finds out, so that is what these assert.
 */
function dt(over: Partial<DocType>): DocType {
  return {
    id: 'x', code: 'X', name: 'X', category: 'PROCUREMENT',
    requiresBudget: false, requiresQuota: false, requiresVendor: false,
    requiresItem: false, requiresPayee: false, isActive: true, ...over,
  };
}

const HINT = '[data-testid="auto-create-inert"]';

function mountFor(documentType: DocType) {
  return mount(RefChainEditor, {
    props: { documentType, allTypes: [documentType] },
    global: { plugins: [i18n, PrimeVue], directives: { tooltip: Tooltip } },
  });
}

beforeAll(() => { i18n.global.locale.value = 'en'; });
afterAll(() => { i18n.global.locale.value = 'la'; });
beforeEach(() => {
  refPairings.mockReset().mockResolvedValue({ successors: [], predecessors: [] });
  departments.mockReset().mockResolvedValue([]);
});

describe('auto-create says when it cannot run', () => {
  it('states it on a predecessor whose post-action does not create successors', async () => {
    const w = mountFor(dt({ code: 'PR', postAction: 'CUT_BUDGET' }));
    await flushPromises();
    expect(w.find(HINT).exists()).toBe(true);
    // Names the type and the prerequisite, not just "this does nothing".
    expect(w.find(HINT).text()).toContain('PR');
    expect(w.find(HINT).text()).toContain('Create successor');
  });

  it('states it on a predecessor with no post-action at all', async () => {
    // Absent is the commonest shape and reaches the dispatcher's default, not the create branch.
    const w = mountFor(dt({ code: 'MEMO' }));
    await flushPromises();
    expect(w.find(HINT).exists()).toBe(true);
  });

  it('says nothing on a predecessor that does create successors', async () => {
    // The assertion that stops the hint appearing on every type in the system.
    const w = mountFor(dt({ code: 'PROC', postAction: 'CREATE_SUCCESSOR' }));
    await flushPromises();
    expect(w.find(HINT).exists()).toBe(false);
  });

  it('leaves the auto-create checkbox usable while the statement is shown', async () => {
    // The statement is advisory. Disabling the control would be a refusal in a different hat, and
    // would force pairing and post-action to be set in an order the screen invented.
    const w = mountFor(dt({ code: 'PR', postAction: 'CUT_BUDGET' }));
    await flushPromises();
    expect(w.find(HINT).exists()).toBe(true);
    const box = w.find('input[type="checkbox"]');
    expect(box.exists()).toBe(true);
    expect(box.attributes('disabled')).toBeUndefined();
  });

  it('never offers a successor department while auto-create is off', async () => {
    // The other inert setting on this screen needs no statement: it is not offered at all unless
    // auto-create is on, which answers the question before it is asked.
    refPairings.mockResolvedValue({
      successors: [{
        id: 'r1', predecessorTypeId: 'x', predecessorCode: 'X',
        successorTypeId: 'y', successorCode: 'PO', autoCreate: false, successorDepartmentId: null,
      }],
      predecessors: [],
    });
    const w = mountFor(dt({ code: 'PROC', postAction: 'CREATE_SUCCESSOR' }));
    await flushPromises();
    expect(w.find('[data-testid="successor-dept-row"]').exists()).toBe(false);
    expect(w.find('[data-testid="new-successor-dept"]').exists()).toBe(false);
  });
});
