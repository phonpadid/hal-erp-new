import { flushPromises, mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import Tooltip from 'primevue/tooltip';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import type { DocType, RefPairing } from '../../api/docConfig';
import RefChainEditor from './RefChainEditor.vue';

const refPairings = vi.fn();
const addRefPairing = vi.fn();
const updateRefPairing = vi.fn();
const removeRefPairing = vi.fn();
const departments = vi.fn();

vi.mock('../../api/docConfig', () => ({
  docConfigApi: {
    refPairings: (...a: unknown[]) => refPairings(...a),
    addRefPairing: (...a: unknown[]) => addRefPairing(...a),
    updateRefPairing: (...a: unknown[]) => updateRefPairing(...a),
    removeRefPairing: (...a: unknown[]) => removeRefPairing(...a),
    departments: (...a: unknown[]) => departments(...a),
  },
}));

const errorFn = vi.fn();
vi.mock('../../composables/useFeedback', () => ({
  useFeedback: () => ({ success: vi.fn(), error: errorFn, confirm: vi.fn(() => Promise.resolve(true)) }),
}));

const global = { plugins: [i18n, PrimeVue], directives: { tooltip: Tooltip } };

function dt(over: Partial<DocType>): DocType {
  return {
    id: over.id ?? 'x', code: over.code ?? 'X', name: over.name ?? 'X',
    category: 'PROCUREMENT', requiresBudget: false, requiresQuota: false,
    requiresVendor: false, requiresItem: false, isActive: true, ...over,
  };
}

const PR = dt({ id: 't-pr', code: 'PR', name: 'Purchase Requisition' });
const PO = dt({ id: 't-po', code: 'PO', name: 'Purchase Order' });
const DISB = dt({ id: 't-disb', code: 'DISB', name: 'Disbursement' });

beforeAll(() => { i18n.global.locale.value = 'en'; });
afterAll(() => { i18n.global.locale.value = 'la'; });
beforeEach(() => {
  refPairings.mockReset();
  addRefPairing.mockReset();
  updateRefPairing.mockReset();
  removeRefPairing.mockReset();
  departments.mockReset();
  errorFn.mockReset();
  departments.mockResolvedValue([
    { id: 'd-proc', name: 'Procurement' },
    { id: 'd-it', name: 'IT' },
  ]);
});

/** A successor pairing row as the API returns it. */
function successor(over: Partial<RefPairing> = {}): RefPairing {
  return {
    id: 'r1',
    predecessorTypeId: 't-pr',
    predecessorCode: 'PR',
    successorTypeId: 't-po',
    successorCode: 'PO',
    autoCreate: true,
    successorDepartmentId: null,
    ...over,
  };
}

function mountEditor(documentType: DocType) {
  return mount(RefChainEditor, {
    props: { documentType, allTypes: [PR, PO, DISB] },
    global,
  });
}

// `<script setup>` bindings (functions, computed) are reachable via the setup-state proxy.
function setup(w: ReturnType<typeof mountEditor>) {
  return (w.vm.$ as unknown as { setupState: Record<string, unknown> }).setupState;
}

describe('RefChainEditor', () => {
  it('loads and renders a type\'s successor and predecessor pairings', async () => {
    refPairings.mockResolvedValue({
      successors: [{ id: 'r1', predecessorTypeId: 't-po', predecessorCode: 'PO', successorTypeId: 't-disb', successorCode: 'DISB' }],
      predecessors: [{ id: 'r2', predecessorTypeId: 't-pr', predecessorCode: 'PR', successorTypeId: 't-po', successorCode: 'PO' }],
    });
    const w = mountEditor(PO);
    await flushPromises();
    expect(refPairings).toHaveBeenCalledWith('t-po');
    const text = w.text();
    expect(text).toContain('DISB'); // successor tag
    expect(text).toContain('PR'); // predecessor tag
  });

  it('adds a successor pairing with (predecessor=this, successor=picked)', async () => {
    refPairings.mockResolvedValue({ successors: [], predecessors: [] });
    addRefPairing.mockResolvedValue({ id: 'new' });
    const w = mountEditor(PR);
    await flushPromises();

    // Directly exercise the add path the "Add successor" button invokes.
    await (setup(w).add as (p: string, s: string) => Promise<void>)('t-pr', 't-po');
    await flushPromises();
    // `add` always sends autoCreate — it defaults to false, which is the manual pairing.
    expect(addRefPairing).toHaveBeenCalledWith({
      predecessorTypeId: 't-pr',
      successorTypeId: 't-po',
      autoCreate: false,
    });
    // Reloads after a successful add.
    expect(refPairings).toHaveBeenCalledTimes(2);
  });

  it('surfaces a duplicate (409) with the dedicated message', async () => {
    refPairings.mockResolvedValue({ successors: [], predecessors: [] });
    addRefPairing.mockRejectedValue({ response: { status: 409 } });
    const w = mountEditor(PR);
    await flushPromises();

    await (setup(w).add as (p: string, s: string) => Promise<void>)('t-pr', 't-po');
    await flushPromises();
    expect(errorFn).toHaveBeenCalledWith('That pairing already exists');
  });

  it('excludes the type itself and already-paired types from the successor options', async () => {
    refPairings.mockResolvedValue({
      successors: [{ id: 'r1', predecessorTypeId: 't-pr', predecessorCode: 'PR', successorTypeId: 't-po', successorCode: 'PO' }],
      predecessors: [],
    });
    const w = mountEditor(PR);
    await flushPromises();
    const opts = setup(w).successorOptions as { value: string }[];
    const ids = opts.map((o) => o.value);
    expect(ids).not.toContain('t-pr'); // self excluded
    expect(ids).not.toContain('t-po'); // already a successor
    expect(ids).toContain('t-disb'); // still available
  });
});

// The successor department decides where an auto-created successor lands — and therefore its form
// and approval route. It is configuration on the pairing rather than something inherited from the
// requester or the approver, so this is where a procurement handoff (PROC→PO into Procurement) is
// expressed.
describe('RefChainEditor — successor department', () => {
  it('shows the configured department on an auto-create pairing', async () => {
    refPairings.mockResolvedValue({
      successors: [successor({ successorDepartmentId: 'd-proc' })],
      predecessors: [],
    });
    const w = mountEditor(PR);
    await flushPromises();

    expect(w.find('[data-testid="successor-dept-label"]').text()).toContain('Procurement');
  });

  it('says the successor stays with the source when no department is configured', async () => {
    refPairings.mockResolvedValue({ successors: [successor({ successorDepartmentId: null })], predecessors: [] });
    const w = mountEditor(PR);
    await flushPromises();

    expect(w.find('[data-testid="successor-dept-label"]').text()).toContain('Same department as the source document');
  });

  it('hides the department on a manual pairing — it has no effect there', async () => {
    refPairings.mockResolvedValue({ successors: [successor({ autoCreate: false })], predecessors: [] });
    const w = mountEditor(PR);
    await flushPromises();

    // A manual create-from takes the department of whoever does the creating.
    expect(w.find('[data-testid="successor-dept-label"]').exists()).toBe(false);
    expect(w.find('[data-testid="successor-dept-row"]').exists()).toBe(false);
  });

  it('offers the department picker on the add form only once auto-create is ticked', async () => {
    refPairings.mockResolvedValue({ successors: [], predecessors: [] });
    const w = mountEditor(PR);
    await flushPromises();
    expect(w.find('[data-testid="new-successor-dept"]').exists()).toBe(false);

    setup(w).newSuccessorAuto = true;
    await flushPromises();

    expect(w.find('[data-testid="new-successor-dept"]').exists()).toBe(true);
  });

  it('sends the chosen department when adding an auto-create pairing', async () => {
    refPairings.mockResolvedValue({ successors: [], predecessors: [] });
    addRefPairing.mockResolvedValue({ id: 'new' });
    const w = mountEditor(PR);
    await flushPromises();
    setup(w).newSuccessorAuto = true;
    setup(w).newSuccessorDeptId = 'd-proc';

    await (setup(w).add as (p: string, s: string, a?: boolean) => Promise<void>)('t-pr', 't-po', true);
    await flushPromises();

    expect(addRefPairing).toHaveBeenCalledWith(
      expect.objectContaining({ autoCreate: true, successorDepartmentId: 'd-proc' }),
    );
  });

  it('omits the department when adding a manual pairing', async () => {
    refPairings.mockResolvedValue({ successors: [], predecessors: [] });
    addRefPairing.mockResolvedValue({ id: 'new' });
    const w = mountEditor(PR);
    await flushPromises();
    // A stale pick must not ride along on a pairing that will never read it.
    setup(w).newSuccessorDeptId = 'd-proc';

    await (setup(w).add as (p: string, s: string, a?: boolean) => Promise<void>)('t-pr', 't-po', false);
    await flushPromises();

    expect(addRefPairing).toHaveBeenCalledWith(
      expect.not.objectContaining({ successorDepartmentId: expect.anything() }),
    );
  });

  it('re-points an existing pairing at a department', async () => {
    refPairings.mockResolvedValue({ successors: [successor()], predecessors: [] });
    updateRefPairing.mockResolvedValue({ id: 'r1' });
    const w = mountEditor(PR);
    await flushPromises();

    await (setup(w).setSuccessorDepartment as (p: RefPairing, d: string | null) => Promise<void>)(
      successor(),
      'd-proc',
    );
    await flushPromises();

    expect(updateRefPairing).toHaveBeenCalledWith('r1', { autoCreate: true, successorDepartmentId: 'd-proc' });
  });

  it('clears the department back to the source document', async () => {
    refPairings.mockResolvedValue({ successors: [successor({ successorDepartmentId: 'd-proc' })], predecessors: [] });
    updateRefPairing.mockResolvedValue({ id: 'r1' });
    const w = mountEditor(PR);
    await flushPromises();

    await (setup(w).setSuccessorDepartment as (p: RefPairing, d: string | null) => Promise<void>)(
      successor({ successorDepartmentId: 'd-proc' }),
      null,
    );
    await flushPromises();

    expect(updateRefPairing).toHaveBeenCalledWith('r1', { autoCreate: true, successorDepartmentId: null });
  });

  it('clears the department when auto-create is turned off', async () => {
    refPairings.mockResolvedValue({ successors: [successor({ successorDepartmentId: 'd-proc' })], predecessors: [] });
    updateRefPairing.mockResolvedValue({ id: 'r1' });
    const w = mountEditor(PR);
    await flushPromises();

    await (setup(w).toggleAuto as (p: RefPairing) => Promise<void>)(
      successor({ successorDepartmentId: 'd-proc' }),
    );
    await flushPromises();

    // Leaving a stale department behind would silently apply if auto-create were turned back on.
    expect(updateRefPairing).toHaveBeenCalledWith('r1', { autoCreate: false, successorDepartmentId: null });
  });

  it('stays usable when the departments cannot be loaded', async () => {
    refPairings.mockResolvedValue({ successors: [successor()], predecessors: [] });
    departments.mockRejectedValue(new Error('boom'));
    const w = mountEditor(PR);
    await flushPromises();

    // Pairing management does not depend on departments — empty just means the source's own.
    expect(w.find('[data-testid="successor-dept-label"]').text()).toContain('Same department as the source document');
  });
});
