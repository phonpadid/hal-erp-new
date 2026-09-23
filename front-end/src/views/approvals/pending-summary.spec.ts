import { flushPromises } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import * as documents from '../../api/documents';
import { mountView } from '../../test/mountView';
import { weekOf, toDay } from '../../utils/week';
import PendingSummaryView from './PendingSummaryView.vue';
import ApprovalInboxView from './ApprovalInboxView.vue';

const toastAdd = vi.fn();
vi.mock('primevue/usetoast', () => ({ useToast: () => ({ add: (...a: unknown[]) => toastAdd(...a) }) }));

let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  vi.restoreAllMocks();
  toastAdd.mockReset();
  document.body.innerHTML = '';
});

const SUMMARY = {
  rows: [
    {
      documentId: 'd1', docNo: 'REC-HAL-2026-0027', documentType: { id: 't1', code: 'REC', name: 'ໃບເບີກຈ່າຍ' },
      department: { id: 'adm', deptCode: 'ADM', name: 'ພະແນກບໍລິຫານ' }, requesterName: 'ນາງ ພອນສະຫວັນ',
      submittedAt: '2026-09-11T02:30:00.000Z', waitingDays: 7, currentStepNo: 2, stepName: 'ຜູ້ອຳນວຍການ',
      waitingOn: [{ userId: 'u1', name: 'Sisavanh' }], currencyCode: 'LAK', grandTotal: '70000000.00', slaDueAt: null, overdue: false,
    },
  ],
  facets: {
    departments: [{ id: 'adm', deptCode: 'ADM', name: 'ພະແນກບໍລິຫານ', count: 3 }, { id: 'hr', deptCode: 'HR', name: 'ບຸກຄະລາກອນ', count: 1 }],
    documentTypes: [{ id: 't1', code: 'REC', name: 'ໃບເບີກຈ່າຍ', count: 4 }],
  },
  byDepartment: [{ id: 'adm', deptCode: 'ADM', name: 'ພະແນກບໍລິຫານ', pendingCount: 1, oldestWaitingDays: 7, totals: { LAK: '70000000.00' } }],
  byStep: [{ stepNo: 2, stepName: 'ຜູ້ອຳນວຍການ', pendingCount: 1, oldestWaitingDays: 7 }],
  byApprover: [{ userId: 'u1', name: 'Sisavanh', pendingCount: 1, oldestWaitingDays: 7 }],
  totals: { pendingCount: 1, overdueCount: 0, amounts: { LAK: '70000000.00' } },
  meta: { companyCode: 'HAL', companyName: 'Hal', baseCurrency: 'LAK', today: '2026-09-18', departmentName: null, submittedFrom: null, submittedTo: null, decimalPlaces: { LAK: 0 } },
};

/** Every GET the view makes; the summary answers with the fixture, anything else with an empty page. */
function stubApi() {
  return vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url === '/approvals/pending-summary') return { data: SUMMARY } as never;
    if (url === '/approvals/pending-summary.xlsx') return { data: new Blob(['x']), headers: { 'content-disposition': 'attachment; filename="pending-approvals-HAL-2026-09-18.xlsx"' } } as never;
    return { data: { items: [], total: 0 } } as never;
  });
}

async function mount(permissions = ['DOC_VIEW', 'DOC_APPROVE']) {
  const w = await mountView(PendingSummaryView, {
    path: '/approvals/summary',
    routeName: 'approvals-summary',
    permissions,
    extraRoutes: [{ path: '/approvals', name: 'approvals' }],
    initialState: { auth: { permissions, baseCurrency: { code: 'LAK', decimalPlaces: 0 } } },
  });
  await flushPromises();
  wrapper = w;
  return w;
}

const summaryCalls = (get: ReturnType<typeof stubApi>) =>
  get.mock.calls.filter((c) => c[0] === '/approvals/pending-summary').map((c) => (c[1] as { params: Record<string, string> }).params);

describe('week presets', () => {
  it('run Monday to Sunday, in the browser calendar', () => {
    const [mon, sun] = weekOf(new Date(2026, 8, 18)); // Friday 18 Sep 2026
    expect(toDay(mon)).toBe('2026-09-14');
    expect(toDay(sun)).toBe('2026-09-20');
    const [lastMon, lastSun] = weekOf(new Date(2026, 8, 18), 1);
    expect([toDay(lastMon), toDay(lastSun)]).toEqual(['2026-09-07', '2026-09-13']);
    // A Sunday belongs to the week that started the Monday before it.
    expect(toDay(weekOf(new Date(2026, 8, 20))[0])).toBe('2026-09-14');
  });
});

describe('PendingSummaryView', () => {
  it('loads everything pending with no filters, and renders the head\'s numbers and the rows', async () => {
    const get = stubApi();
    const w = await mount();
    expect(summaryCalls(get)[0]).toEqual({});
    expect(w.find('[data-testid="summary-totals"]').text()).toContain('1');
    expect(w.text()).toContain('REC-HAL-2026-0027');
    expect(w.text()).toContain('Sisavanh');
    expect(w.text()).toContain('ນາງ ພອນສະຫວັນ');
  });

  it('sends last week as Monday–Sunday day strings', async () => {
    const get = stubApi();
    const w = await mount();
    await w.find('[data-testid="preset-lastWeek"]').trigger('click');
    await flushPromises();
    const [mon, sun] = weekOf(new Date(), 1);
    expect(summaryCalls(get).at(-1)).toEqual({ submittedFrom: toDay(mon), submittedTo: toDay(sun) });
    // Back to everything: no date parameters at all.
    await w.find('[data-testid="preset-all"]').trigger('click');
    await flushPromises();
    expect(summaryCalls(get).at(-1)).toEqual({});
  });

  it('offers the departments and types present in the facets, and sends the chosen one', async () => {
    const get = stubApi();
    const w = await mount();
    const dept = w.findComponent({ name: 'Select', props: { placeholder: 'ທຸກພະແນກ' } });
    expect(dept.exists()).toBe(true);
    expect((dept.props('options') as Array<{ label: string }>).map((o) => o.label)).toEqual(['ພະແນກບໍລິຫານ (3)', 'ບຸກຄະລາກອນ (1)']);
    dept.vm.$emit('update:modelValue', 'adm');
    await flushPromises();
    expect(summaryCalls(get).at(-1)).toEqual({ departmentId: 'adm' });
    // The active-filter chip, in the test locale (la).
    expect(w.text()).toContain('ພະແນກ: ພະແນກບໍລິຫານ');
  });

  it('exports with the filters on screen and downloads under the server\'s name', async () => {
    const get = stubApi();
    const download = vi.spyOn(documents, 'downloadBlob').mockImplementation(() => undefined);
    const w = await mount();
    await w.find('[data-testid="preset-thisWeek"]').trigger('click');
    await flushPromises();
    await w.find('[data-testid="export-summary"]').trigger('click');
    await flushPromises();
    const call = get.mock.calls.find((c) => c[0] === '/approvals/pending-summary.xlsx')!;
    const [mon, sun] = weekOf(new Date());
    expect((call[1] as { params: unknown }).params).toEqual({ submittedFrom: toDay(mon), submittedTo: toDay(sun) });
    expect((call[1] as { responseType: string }).responseType).toBe('blob');
    expect(download).toHaveBeenCalledWith(expect.any(Blob), 'pending-approvals-HAL-2026-09-18.xlsx');
  });

  it('reports a failed export and re-enables the button', async () => {
    const get = stubApi();
    const w = await mount();
    get.mockImplementation(async (url: string) => {
      if (url === '/approvals/pending-summary.xlsx') throw new Error('boom');
      return { data: SUMMARY } as never;
    });
    await w.find('[data-testid="export-summary"]').trigger('click');
    await flushPromises();
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
    expect(w.find('[data-testid="export-summary"]').attributes('disabled')).toBeUndefined();
  });

  it('shows both tabs to a user holding both codes, and only the summary tab without DOC_APPROVE', async () => {
    stubApi();
    let w = await mount(['DOC_VIEW', 'DOC_APPROVE']);
    expect(w.find('[data-testid="tab-approvals"]').exists()).toBe(true);
    expect(w.find('[data-testid="tab-approvals-summary"]').exists()).toBe(true);
    w.unmount();
    w = await mount(['DOC_VIEW']);
    // One tab is no choice — the header is not drawn at all.
    expect(w.find('[data-testid="tab-approvals"]').exists()).toBe(false);
  });
});

describe('ApprovalInboxView tabs', () => {
  it('does not offer the summary tab without DOC_VIEW', async () => {
    stubApi();
    const w = await mountView(ApprovalInboxView, {
      path: '/approvals',
      routeName: 'approvals',
      permissions: ['DOC_APPROVE'],
      extraRoutes: [{ path: '/approvals/summary', name: 'approvals-summary' }],
      initialState: { auth: { permissions: ['DOC_APPROVE'] } },
    });
    await flushPromises();
    wrapper = w;
    expect(w.find('[data-testid="tab-approvals-summary"]').exists()).toBe(false);
  });
});
