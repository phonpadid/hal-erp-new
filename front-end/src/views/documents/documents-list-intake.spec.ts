import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VueWrapper } from '@vue/test-utils';
import { mountView } from '../../test/mountView';
import MyDocumentsView from './MyDocumentsView.vue';
import { documentsApi } from '../../api/documents';
import { approvalsApi } from '../../api/approvals';
import { paymentsApi } from '../../api/payments';
import { useDocumentsStore } from '../../stores/documents';

// The batch result is reported through `useFeedback`, which is a thin wrapper over PrimeVue's
// toast service. Spying on the service is how the per-document reporting becomes assertable —
// what matters is that ONE refusal produces its own named message beside the success, rather than
// a single verdict for the whole batch.
const { toastAdd } = vi.hoisted(() => ({ toastAdd: vi.fn() }));
vi.mock('primevue/usetoast', () => ({ useToast: () => ({ add: toastAdd }) }));

let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  vi.restoreAllMocks();
});

type Row = Record<string, unknown> & { id: string };

/**
 * Mounted EMPTY and then filled, like its sibling specs: the per-page reads hang off a watcher on
 * `docs.list`, and a watcher does not fire for state that was already there when it was created.
 */
async function mount(rows: Row[], permissions: string[]) {
  const w = await mountView(MyDocumentsView, {
    path: '/documents',
    routeName: 'documents',
    permissions,
    initialState: {
      documents: {
        list: [],
        total: rows.length,
        page: 1,
        limit: 20,
        filters: {},
        typeOptions: { status: 'loaded', items: [] },
        loading: false,
        error: '',
      },
      masterData: { vendors: [], vendorsStatus: 'loaded', loading: false, error: '' },
      // `mountView` spreads initialState over its own auth defaults, so an auth override has to
      // carry `permissions` too or it silently un-grants everything the mount just granted.
      auth: { permissions, baseCurrency: { code: 'LAK', decimalPlaces: 0 } },
    },
  });
  await flushPromises();
  wrapper = w;
  const store = useDocumentsStore();
  store.list = rows.map((r) => ({
    docNo: `D-${r.id}`,
    documentType: { name: 'Memo' },
    status: 'IN_APPROVAL',
    ...r,
  })) as never;
  await flushPromises();
  return w;
}

const RECEIVED = { received: true, receivedByName: 'Bounmy Keo', receivedAt: '2026-09-18T02:00:00.000Z', canReceive: false };
/** Not received, and the route HAS reached this reader — the server says they may take it. */
const RECEIVABLE = { received: false, receivedByName: null, receivedAt: null, canReceive: true };
/** Not received, and the route has NOT reached this reader — the server would refuse. */
const NOT_REACHED = { received: false, receivedByName: null, receivedAt: null, canReceive: false };

beforeEach(() => {
  toastAdd.mockClear();
  vi.spyOn(paymentsApi, 'slipStatus').mockResolvedValue({});
});

/**
 * The Approve action is the server's answer, not a guess.
 *
 * It used to be `status === 'IN_APPROVAL' && can('DOC_APPROVE')`, rendered always and merely
 * disabled. `DOC_APPROVE` is held company-wide, so that offered the action on every in-approval
 * document — including ones on somebody else's step and including the reader's own requests, which
 * invariant 8 forbids anyone from approving.
 */
describe('documents list: the Approve action', () => {
  it('renders no button at all for a row the server did not call actionable', async () => {
    vi.spyOn(approvalsApi, 'actionable').mockResolvedValue([]);
    const w = await mount([{ id: 'a' }], ['DOC_VIEW', 'DOC_APPROVE']);
    await flushPromises();
    // Absent, not disabled: a disabled control still says the system contemplates the action.
    expect(w.find('[data-testid="approve-row"]').exists()).toBe(false);
  });

  it('renders the button for a row the server did call actionable', async () => {
    vi.spyOn(approvalsApi, 'actionable').mockResolvedValue(['a']);
    const w = await mount([{ id: 'a' }, { id: 'b' }], ['DOC_VIEW', 'DOC_APPROVE']);
    await flushPromises();
    const buttons = w.findAll('[data-testid="approve-row"]');
    expect(buttons).toHaveLength(1);
  });

  it('asks only about the rows that are in approval', async () => {
    const spy = vi.spyOn(approvalsApi, 'actionable').mockResolvedValue([]);
    await mount([{ id: 'a' }, { id: 'b', status: 'COMPLETED' }, { id: 'c', status: 'DRAFT' }], [
      'DOC_VIEW',
      'DOC_APPROVE',
    ]);
    await flushPromises();
    expect(spy).toHaveBeenCalledWith(['a']);
  });

  it('asks nothing, and offers nothing, without DOC_APPROVE', async () => {
    const spy = vi.spyOn(approvalsApi, 'actionable').mockResolvedValue(['a']);
    const w = await mount([{ id: 'a' }], ['DOC_VIEW']);
    await flushPromises();
    expect(spy).not.toHaveBeenCalled();
    expect(w.find('[data-testid="approve-row"]').exists()).toBe(false);
  });
});

describe('documents list: the intake column', () => {
  beforeEach(() => {
    vi.spyOn(approvalsApi, 'actionable').mockResolvedValue([]);
  });

  it('tells received and not-received apart', async () => {
    const w = await mount(
      [{ id: 'a', intake: RECEIVED }, { id: 'b', intake: RECEIVABLE }],
      ['DOC_VIEW', 'DOC_INTAKE_RECEIVE'],
    );
    await flushPromises();
    expect(w.findAll('[data-testid="intake-received"]')).toHaveLength(1);
    expect(w.findAll('[data-testid="intake-not-received"]')).toHaveLength(1);
  });

  it('reads a row the server sent no intake state for as not received', async () => {
    const w = await mount([{ id: 'a' }], ['DOC_VIEW', 'DOC_INTAKE_RECEIVE']);
    await flushPromises();
    expect(w.find('[data-testid="intake-not-received"]').exists()).toBe(true);
  });

  it('shows no intake column at all to a department with no intake duty', async () => {
    // The whole column, not just its actions: intake is one office's record of what landed on
    // its desk, and a column every department reads would make it look like a state of the
    // document itself.
    const w = await mount([{ id: 'a', intake: RECEIVABLE }], ['DOC_VIEW', 'DOC_APPROVE']);
    await flushPromises();
    expect(w.find('[data-testid="intake-not-received"]').exists()).toBe(false);
    expect(w.find('[data-testid="intake-received"]').exists()).toBe(false);
    expect(w.text()).not.toContain('ການຮັບເອກະສານ');
    expect(w.find('[data-testid="receive-selected"]').exists()).toBe(false);
    expect(w.find('.p-datatable thead input[type="checkbox"]').exists()).toBe(false);
  });

  it('shows the column to a holder of either intake code', async () => {
    const reverser = await mount([{ id: 'a', intake: RECEIVED }], ['DOC_VIEW', 'DOC_INTAKE_REVERSE']);
    await flushPromises();
    expect(reverser.find('[data-testid="intake-received"]').exists()).toBe(true);
  });

  it('offers the bulk action AND a tick box per row to a holder of DOC_INTAKE_RECEIVE', async () => {
    const w = await mount([{ id: 'a', intake: RECEIVABLE }], ['DOC_VIEW', 'DOC_INTAKE_RECEIVE']);
    await flushPromises();
    expect(w.find('[data-testid="receive-selected"]').exists()).toBe(true);
    // The selection column is what the bulk action acts on; without it the button can never
    // become enabled, and a disabled button with no visible way to enable it is the bug this
    // asserts against.
    expect(w.findAll('.p-datatable tbody input[type="checkbox"], .p-datatable tbody .p-checkbox').length)
      .toBeGreaterThan(0);
  });

  it('offers a receive button on the row itself, not only in the toolbar', async () => {
    // The toolbar button greys out until something is ticked, and the tick boxes are in the
    // leftmost column of a table that scrolls sideways. Without a way in on the row, a wide
    // screen showed no enabled control at all.
    const send = vi.spyOn(documentsApi, 'receiveIntake').mockResolvedValue([
      { documentId: 'a', received: true, refusal: null },
    ]);
    const w = await mount([{ id: 'a', intake: RECEIVABLE }], ['DOC_VIEW', 'DOC_INTAKE_RECEIVE']);
    await flushPromises();

    const rowButton = w.find('[data-testid="intake-receive-row"]');
    expect(rowButton.exists()).toBe(true);
    await rowButton.trigger('click');
    await flushPromises();
    expect(send).toHaveBeenCalledWith(['a']);
  });

  it('offers no row button on a document the route has not reached', async () => {
    // The whole point of the server's per-row verdict: a receive button on a document that has
    // not arrived is a button that is always refused, which is worse than no button.
    const w = await mount([{ id: 'a', intake: NOT_REACHED }], ['DOC_VIEW', 'DOC_INTAKE_RECEIVE']);
    await flushPromises();
    expect(w.find('[data-testid="intake-not-received"]').exists()).toBe(true);
    expect(w.find('[data-testid="intake-receive-row"]').exists()).toBe(false);
  });

  it('does not count an unreached row towards the bulk action', async () => {
    const send = vi.spyOn(documentsApi, 'receiveIntake').mockResolvedValue([
      { documentId: 'a', received: true, refusal: null },
    ]);
    const w = await mount(
      [{ id: 'a', intake: RECEIVABLE }, { id: 'b', intake: NOT_REACHED }],
      ['DOC_VIEW', 'DOC_INTAKE_RECEIVE'],
    );
    await flushPromises();

    (w.vm as unknown as { selectedRows: unknown[] }).selectedRows = [...useDocumentsStore().list];
    await flushPromises();
    await w.find('[data-testid="receive-selected"]').trigger('click');
    await flushPromises();

    expect(send).toHaveBeenCalledWith(['a']);
  });

  it('offers no row button on a document already received, nor without the code', async () => {
    const received = await mount([{ id: 'a', intake: RECEIVED }], ['DOC_VIEW', 'DOC_INTAKE_RECEIVE']);
    await flushPromises();
    expect(received.find('[data-testid="intake-receive-row"]').exists()).toBe(false);
    received.unmount();

    const reverserOnly = await mount([{ id: 'a', intake: RECEIVABLE }], ['DOC_VIEW', 'DOC_INTAKE_REVERSE']);
    await flushPromises();
    expect(reverserOnly.find('[data-testid="intake-receive-row"]').exists()).toBe(false);
  });

  it('offers reversal only with its own code', async () => {
    const receiveOnly = await mount([{ id: 'a', intake: RECEIVED }], ['DOC_VIEW', 'DOC_INTAKE_RECEIVE']);
    await flushPromises();
    expect(receiveOnly.find('[data-testid="intake-reverse"]').exists()).toBe(false);
    receiveOnly.unmount();

    const w = await mount([{ id: 'a', intake: RECEIVED }], ['DOC_VIEW', 'DOC_INTAKE_REVERSE']);
    await flushPromises();
    expect(w.find('[data-testid="intake-reverse"]').exists()).toBe(true);
  });
});

describe('documents list: registering a batch', () => {
  beforeEach(() => {
    vi.spyOn(approvalsApi, 'actionable').mockResolvedValue([]);
  });

  it('sends only the rows that are not already received', async () => {
    const send = vi.spyOn(documentsApi, 'receiveIntake').mockResolvedValue([
      { documentId: 'a', received: true, refusal: null },
    ]);
    const w = await mount(
      [{ id: 'a', intake: RECEIVABLE }, { id: 'b', intake: RECEIVED }],
      ['DOC_VIEW', 'DOC_INTAKE_RECEIVE'],
    );
    await flushPromises();

    // Tick both, including the one already taken. The screen must not offer to re-send it.
    (w.vm as unknown as { selectedRows: unknown[] }).selectedRows = [...useDocumentsStore().list];
    await flushPromises();
    await w.find('[data-testid="receive-selected"]').trigger('click');
    await flushPromises();

    expect(send).toHaveBeenCalledWith(['a']);
  });

  it('names the documents it could not register, rather than failing the batch', async () => {
    vi.spyOn(documentsApi, 'receiveIntake').mockResolvedValue([
      { documentId: 'a', received: true, refusal: null },
      { documentId: 'b', received: false, refusal: 'ALREADY_RECEIVED' },
    ]);
    const w = await mount(
      [{ id: 'a', intake: RECEIVABLE }, { id: 'b', intake: RECEIVABLE }],
      ['DOC_VIEW', 'DOC_INTAKE_RECEIVE'],
    );
    await flushPromises();

    (w.vm as unknown as { selectedRows: unknown[] }).selectedRows = [...useDocumentsStore().list];
    await flushPromises();
    await w.find('[data-testid="receive-selected"]').trigger('click');
    await flushPromises();

    // One message says how many landed, another names the one that did not and why — not a single
    // verdict for the whole batch, which is what makes a shared intake queue usable.
    const sent = toastAdd.mock.calls.map((c) => c[0] as { severity: string; detail?: string });
    expect(sent.some((m) => m.severity === 'success')).toBe(true);
    const warned = sent.find((m) => m.severity === 'warn');
    expect(warned?.detail).toContain('D-b');
  });
});

/**
 * The base-currency column says which currency it is, at that currency's precision.
 *
 * It used to call `formatAmount` with the default two decimal places and print no code at all,
 * so a Lao company — whose kip carries none — read `100,000.00` for a figure that has no
 * hundredths, on a list whose rows may each be in a different document currency.
 */
describe('documents list: the base-currency total', () => {
  beforeEach(() => {
    vi.spyOn(approvalsApi, 'actionable').mockResolvedValue([]);
  });

  it('formats to the base currency decimal places and names it', async () => {
    const w = await mount([{ id: 'a', baseTotalAmount: '100000' }], ['DOC_VIEW']);
    await flushPromises();
    const text = w.text();
    expect(text).toContain('100,000 LAK');
    expect(text).not.toContain('100,000.00');
  });

  it('says nothing rather than zero for a row carrying no base total', async () => {
    const w = await mount([{ id: 'a', baseTotalAmount: null }], ['DOC_VIEW']);
    await flushPromises();
    expect(w.text()).not.toContain('0 LAK');
  });
});
