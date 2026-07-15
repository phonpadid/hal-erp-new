import { flushPromises, mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import Tooltip from 'primevue/tooltip';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import type { DocType } from '../../api/docConfig';
import RefChainEditor from './RefChainEditor.vue';

const refPairings = vi.fn();
const addRefPairing = vi.fn();
const removeRefPairing = vi.fn();

vi.mock('../../api/docConfig', () => ({
  docConfigApi: {
    refPairings: (...a: unknown[]) => refPairings(...a),
    addRefPairing: (...a: unknown[]) => addRefPairing(...a),
    removeRefPairing: (...a: unknown[]) => removeRefPairing(...a),
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
  removeRefPairing.mockReset();
  errorFn.mockReset();
});

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
    expect(addRefPairing).toHaveBeenCalledWith({ predecessorTypeId: 't-pr', successorTypeId: 't-po' });
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
