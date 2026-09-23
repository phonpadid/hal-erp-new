import { flushPromises } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import * as documents from '../../api/documents';
import { documentsApi } from '../../api/documents';
import type { PendingApproval } from '../../api/approvals';
import type { IntakeState } from '../../api/documents';
import { useApprovalsStore } from '../../stores/approvals';
import { mountView } from '../../test/mountView';
import ApprovalInboxView from './ApprovalInboxView.vue';

// Toasts are how a refused receipt and a failed export are reported; spying on the service makes
// that assertable.
const { toastAdd } = vi.hoisted(() => ({ toastAdd: vi.fn() }));
vi.mock('primevue/usetoast', () => ({ useToast: () => ({ add: toastAdd }) }));

let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});
beforeEach(() => toastAdd.mockClear());

const RECEIVED: IntakeState = { received: true, receivedByName: 'Bounmy Keo', receivedAt: '2026-09-18T02:00:00.000Z', canReceive: false };
const RECEIVABLE: IntakeState = { received: false, receivedByName: null, receivedAt: null, canReceive: true };
const NOT_REACHED: IntakeState = { received: false, receivedByName: null, receivedAt: null, canReceive: false };

function row(id: string, intake = NOT_REACHED): PendingApproval {
  return {
    id,
    docNo: `PR-${id}`,
    documentType: { code: 'PR', name: 'Purchase request' },
    requesterName: 'Jiji Phommavong',
    requesterDepartment: 'Finance',
    baseTotalAmount: '1000000',
    currentStepNo: 2,
    submittedAt: '2026-09-18T02:00:00.000Z',
    slaDueAt: null,
    overdue: false,
    intake,
  };
}

/**
 * Mounted EMPTY and then filled: the selection is cleared by a watcher on `approvals.pending`, and a
 * watcher does not fire for state that was already there when it was created.
 */
async function mount(rows: PendingApproval[], permissions: string[] = ['DOC_APPROVE', 'DEPARTMENT_VIEW']) {
  const w = await mountView(ApprovalInboxView, {
    path: '/approvals',
    routeName: 'approvals',
    permissions,
    initialState: {
      approvals: { pending: [], total: 0, page: 1, limit: 20, loading: false, error: '', search: '', filters: {} },
      org: { departments: [{ id: 'dept-fin', name: 'Finance' }] },
    },
  });
  await flushPromises();
  wrapper = w;
  const store = useApprovalsStore();
  store.pending = rows;
  store.total = rows.length;
  await flushPromises();
  return w;
}

type Vm = {
  f: { departmentId: string | null; dateRange: (Date | null)[] | null; minAmount: string; maxAmount: string };
  apply: () => void;
  selectedRows: PendingApproval[];
};
const vmOf = (w: VueWrapper) => w.vm as unknown as Vm;

/** The panel lives in a Popover, which renders nothing until it is opened. */
async function openFilters(w: VueWrapper): Promise<HTMLElement> {
  await w.find('[data-testid="inbox-filters"]').trigger('click');
  await flushPromises();
  return document.body.querySelector('[data-testid="inbox-filter-panel"]') as HTMLElement;
}

describe('approval inbox: filters', () => {
  it('offers department, submitted date and amount — and nothing else', async () => {
    const w = await mount([row('a')]);
    const panel = await openFilters(w);
    expect(panel).not.toBeNull();
    expect(panel.querySelector('[data-testid="filter-department"]')).not.toBeNull();
    expect(panel.querySelector('[data-testid="filter-submitted"]')).not.toBeNull();
    expect(panel.querySelector('[data-testid="filter-min-amount"]')).not.toBeNull();
    expect(panel.querySelector('[data-testid="filter-max-amount"]')).not.toBeNull();
    // Status is fixed at pending; type, vendor and "only mine" are the documents list's.
    expect(panel.querySelector('.p-multiselect')).toBeNull();
    expect(panel.querySelector('[data-testid="filter-mine"]')).toBeNull();
    expect(panel.querySelectorAll('.p-select').length).toBe(1);
  });

  it('sends a chosen department to the server, which answers from page 1', async () => {
    const w = await mount([row('a')]);
    const store = useApprovalsStore();
    vmOf(w).f.departmentId = 'dept-fin';
    vmOf(w).apply();
    await flushPromises();
    expect(store.applyFilters).toHaveBeenLastCalledWith(expect.objectContaining({ departmentId: 'dept-fin' }));
    expect(w.find('[data-testid="chip-dept"]').text()).toContain('Finance');
  });

  it('sends the day range as calendar days and the amounts as the strings typed', async () => {
    const w = await mount([row('a')]);
    const store = useApprovalsStore();
    vmOf(w).f.dateRange = [new Date(2026, 8, 14), new Date(2026, 8, 18)];
    vmOf(w).f.minAmount = '1000000.50';
    vmOf(w).apply();
    await flushPromises();
    expect(store.applyFilters).toHaveBeenLastCalledWith({
      departmentId: undefined,
      submittedFrom: '2026-09-14',
      submittedTo: '2026-09-18',
      minAmount: '1000000.50',
      maxAmount: undefined,
    });
  });

  it('removing a chip removes only its filter', async () => {
    const w = await mount([row('a')]);
    const store = useApprovalsStore();
    vmOf(w).f.departmentId = 'dept-fin';
    vmOf(w).f.dateRange = [new Date(2026, 8, 14), new Date(2026, 8, 18)];
    await flushPromises();

    await w.find('[data-testid="chip-dept"] .p-chip-remove-icon').trigger('click');
    await flushPromises();

    const sent = (store.applyFilters as unknown as ReturnType<typeof vi.fn>).mock.lastCall![0];
    expect(sent.departmentId).toBeUndefined();
    expect(sent.submittedFrom).toBe('2026-09-14');
    expect(w.find('[data-testid="chip-dept"]').exists()).toBe(false);
    expect(w.find('[data-testid="chip-date"]').exists()).toBe(true);
  });
});

describe('approval inbox: Excel export', () => {
  it('exports the whole inbox under the filters on screen, even before the debounce lands', async () => {
    const w = await mount([row('a')]);
    const get = vi.spyOn(api, 'get').mockResolvedValue({
      data: new Blob(['x']),
      headers: { 'content-disposition': 'attachment; filename="pending-approvals-payables-HAL-2026-09-23.xlsx"' },
    } as never);
    const download = vi.spyOn(documents, 'downloadBlob').mockImplementation(() => undefined);

    vmOf(w).f.departmentId = 'dept-fin';
    vmOf(w).f.maxAmount = '5000000';
    await w.find('[data-testid="export-pending"]').trigger('click');
    await flushPromises();

    const call = get.mock.calls.find((c) => c[0] === '/approvals/pending/payables.xlsx');
    expect(call).toBeDefined();
    const opts = call![1] as { params: Record<string, string>; responseType: string };
    // Every page: no page window travels with the export.
    expect(opts.params).toEqual({ departmentId: 'dept-fin', maxAmount: '5000000' });
    expect(opts.responseType).toBe('blob');
    expect(download).toHaveBeenCalledWith(expect.any(Blob), 'pending-approvals-payables-HAL-2026-09-23.xlsx');
  });

  it('reports a failed export and re-enables the button', async () => {
    const w = await mount([row('a')]);
    vi.spyOn(api, 'get').mockRejectedValue(new Error('boom'));
    const button = () => w.find('[data-testid="export-pending"]');

    await button().trigger('click');
    await flushPromises();

    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
    expect(button().attributes('disabled')).toBeUndefined();
  });
});

describe('approval inbox: finance intake', () => {
  it('shows no intake column, selection or action to an approver with no intake duty', async () => {
    const w = await mount([row('a', RECEIVABLE)], ['DOC_APPROVE']);
    expect(w.find('[data-testid="intake-not-received"]').exists()).toBe(false);
    expect(w.find('[data-testid="intake-receive-row"]').exists()).toBe(false);
    expect(w.find('[data-testid="receive-selected"]').exists()).toBe(false);
    expect(w.find('.p-datatable thead input[type="checkbox"]').exists()).toBe(false);
  });

  it('shows the column to a holder of either intake code', async () => {
    const w = await mount([row('a', RECEIVED)], ['DOC_APPROVE', 'DOC_INTAKE_REVERSE']);
    expect(w.find('[data-testid="intake-received"]').exists()).toBe(true);
    expect(w.find('[data-testid="intake-reverse"]').exists()).toBe(true);
    // Reversal alone is not receiving.
    expect(w.find('[data-testid="receive-selected"]').exists()).toBe(false);
  });

  it('receives a single document from its row', async () => {
    const send = vi.spyOn(documentsApi, 'receiveIntake').mockResolvedValue([
      { documentId: 'a', received: true, refusal: null },
    ] as never);
    const w = await mount([row('a', RECEIVABLE)], ['DOC_APPROVE', 'DOC_INTAKE_RECEIVE']);

    await w.find('[data-testid="intake-receive-row"]').trigger('click');
    await flushPromises();

    expect(send).toHaveBeenCalledWith(['a']);
    expect(useApprovalsStore().loadPending).toHaveBeenCalled();
  });

  it('offers no receive on a row the server did not call receivable, nor on one already received', async () => {
    const w = await mount([row('a', NOT_REACHED), row('b', RECEIVED)], ['DOC_APPROVE', 'DOC_INTAKE_RECEIVE']);
    expect(w.findAll('[data-testid="intake-receive-row"]')).toHaveLength(0);
    expect(w.find('[data-testid="intake-received"]').exists()).toBe(true);
    // No reversal without its own code.
    expect(w.find('[data-testid="intake-reverse"]').exists()).toBe(false);
  });

  it('receives the receivable part of a selection, and names what the server refused', async () => {
    const send = vi.spyOn(documentsApi, 'receiveIntake').mockResolvedValue([
      { documentId: 'a', received: true, refusal: null },
      { documentId: 'b', received: false, refusal: 'ALREADY_RECEIVED' },
    ] as never);
    const w = await mount(
      [row('a', RECEIVABLE), row('b', RECEIVABLE), row('c', NOT_REACHED)],
      ['DOC_APPROVE', 'DOC_INTAKE_RECEIVE'],
    );

    vmOf(w).selectedRows = [...useApprovalsStore().pending];
    await flushPromises();
    await w.find('[data-testid="receive-selected"]').trigger('click');
    await flushPromises();

    // The unreached row is never sent.
    expect(send).toHaveBeenCalledWith(['a', 'b']);
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success' }));
    const warn = toastAdd.mock.calls.find((c) => c[0].severity === 'warn');
    expect(warn).toBeDefined();
    expect(JSON.stringify(warn![0])).toContain('PR-b');
  });

  it('clears the selection when the rows change, so paging never carries ticks over', async () => {
    const w = await mount([row('a', RECEIVABLE)], ['DOC_APPROVE', 'DOC_INTAKE_RECEIVE']);
    vmOf(w).selectedRows = [...useApprovalsStore().pending];
    await flushPromises();
    expect(vmOf(w).selectedRows).toHaveLength(1);

    useApprovalsStore().pending = [row('z', RECEIVABLE)];
    await flushPromises();
    expect(vmOf(w).selectedRows).toHaveLength(0);
    expect(w.find('[data-testid="receive-selected"]').attributes('disabled')).toBeDefined();
  });
});

describe('approval inbox: requester', () => {
  it("names the requester's department under their name", async () => {
    const w = await mount([row('a')]);
    expect(w.find('[data-testid="requester"]').text()).toBe('Jiji Phommavong');
    expect(w.find('[data-testid="requester-department"]').text()).toBe('Finance');
  });
});
