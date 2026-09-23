import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VueWrapper } from '@vue/test-utils';
import { mountView } from '../../test/mountView';
import DocumentDetailView from './DocumentDetailView.vue';

let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const PERMS = ['DOC_VIEW'];

async function mount(pendingApprovers: Record<string, unknown> | null) {
  const w = await mountView(DocumentDetailView, {
    path: '/documents/:id',
    routeName: 'document-detail',
    routeParams: { id: 'doc-1' },
    permissions: PERMS,
    initialState: {
      documents: {
        current: { id: 'doc-1', docNo: 'D-1', status: 'IN_APPROVAL', currency: { code: 'LAK', decimalPlaces: 0 } },
        hasPayment: false, hasSlip: false, slipRequired: false, canRestateRate: false,
        budgets: [], fieldValues: [], lines: [], attachments: [], refDocument: null,
        approvalLog: [], canAct: false, sla: null, pendingApprovers, matching: null,
        budgetMovements: [], loading: false, error: '',
      },
      auth: { permissions: PERMS, baseCurrency: { code: 'LAK', decimalPlaces: 0 } },
      currency: { currencies: [{ code: 'LAK', decimalPlaces: 0 }] },
    },
  });
  await flushPromises();
  wrapper = w;
  return w;
}

const WAITING = (extra: Record<string, unknown>) => ({
  stepNo: 2,
  approveMode: 'SEQUENTIAL',
  approvers: [{ userId: 'u1', name: 'ນາງ ລັດຕະນາພອນ ສຸກສາຄອນ' }],
  ...extra,
});

/**
 * What a requester opens their own document to find out: how far it has got, and who has it.
 *
 * The entry said `ຂັ້ນທີ 2` — which reads the same whether the route has three steps or seven,
 * and so answered only the second half of the question.
 */
describe('document detail: the pending entry says how far through the route it is', () => {
  it('states the step as a position in the route, beside whoever holds it', async () => {
    const w = await mount(WAITING({ totalSteps: 6 }));
    const text = w.text();
    expect(text).toContain('ຂັ້ນທີ 2 ຈາກ 6');
    expect(text).toContain('ນາງ ລັດຕະນາພອນ ສຸກສາຄອນ');
  });

  it('keeps the step name alongside the position', async () => {
    const w = await mount(WAITING({ totalSteps: 6, stepName: 'ກວດສອບງົບປະມານ' }));
    const text = w.text();
    expect(text).toContain('ຂັ້ນທີ 2 ຈາກ 6');
    expect(text).toContain('ກວດສອບງົບປະມານ');
  });

  it('falls back to the bare step when the server sent no total', async () => {
    // A response from before this field existed, or a deploy caught mid-flight. It must read
    // `ຂັ້ນທີ 2`, never `ຂັ້ນທີ 2 ຈາກ undefined`.
    const w = await mount(WAITING({}));
    const text = w.text();
    expect(text).toContain('ຂັ້ນທີ 2');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('ຈາກ');
  });

  it('shows no pending entry at all when the read returned none', async () => {
    const w = await mount(null);
    expect(w.text()).not.toContain('ຂັ້ນທີ 2');
  });
});
