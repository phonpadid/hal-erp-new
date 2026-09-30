import { flushPromises, mount } from '@vue/test-utils';
import ConfirmationService from 'primevue/confirmationservice';
import PrimeVue from 'primevue/config';
import ToastService from 'primevue/toastservice';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import ReviewApprovalDialog from './ReviewApprovalDialog.vue';

const detail = vi.fn();
const canActApi = vi.fn();
vi.mock('../../api/documents', () => ({
  documentsApi: {
    detail: (...a: unknown[]) => detail(...a),
    canAct: (...a: unknown[]) => canActApi(...a),
  },
}));

const act = vi.fn();
const store = { act: (...a: unknown[]) => act(...a), error: '', errorCode: undefined as string | undefined };
vi.mock('../../stores/approvals', () => ({ useApprovalsStore: () => store }));

const can = vi.fn((_code: string) => true);
vi.mock('../../stores/auth', () => ({ useAuthStore: () => ({ can: (c: string) => can(c), hasSignature: true, setHasSignature: vi.fn() }) }));
vi.mock('../../composables/useFeedback', () => ({
  useFeedback: () => ({ error: vi.fn(), success: vi.fn() }),
}));
vi.mock('../../composables/useCurrencyFormat', () => ({
  useCurrencyFormat: () => ({ fmt: (v: string) => v, fmtBase: (v: string) => v, baseCode: () => 'LAK' }),
}));

// The slips panel is exercised by its own spec; here it only needs to exist and emit.
vi.mock('../payments/PaymentSlips.vue', () => ({
  default: {
    name: 'PaymentSlips',
    props: ['documentId'],
    emits: ['changed'],
    template: '<button data-testid="stub-upload" @click="$emit(\'changed\')">upload</button>',
  },
}));

const globalOpts = { plugins: [i18n, PrimeVue, ToastService, ConfirmationService] };

type DetailOver = {
  slipRequired: boolean;
  hasSlip: boolean;
  budgets: Array<{ id: string; name: string; amountTotal: string; available: string; charged: string }>;
};

function detailPayload(over: Partial<DetailOver> = {}) {
  return {
    document: { id: 'd1', docNo: 'D-1', status: 'IN_APPROVAL', baseTotalAmount: '100' },
    requesterName: 'somchai',
    fieldValues: [],
    lines: [],
    attachments: [],
    refDocument: null,
    hasPayment: false,
    slipRequired: over.slipRequired ?? false,
    hasSlip: over.hasSlip ?? false,
    budgets: over.budgets ?? [],
  };
}

/**
 * PrimeVue's Dialog teleports its content to `document.body`, so the mounted wrapper sees none of
 * it. Every query below therefore goes through the document, not the wrapper.
 */
async function open() {
  // Mounted closed, then opened — the component loads on the visible watcher, which (correctly) has
  // no `immediate`, so a dialog mounted already-open would never fetch anything.
  const w = mount(ReviewApprovalDialog, {
    props: { docId: 'd1', docNo: 'D-1', visible: false },
    global: globalOpts,
    attachTo: document.body,
  });
  await w.setProps({ visible: true });
  await flushPromises();
  return w;
}

const el = (sel: string) => document.body.querySelector(sel);
const approveBtn = () => el('[data-testid="approve-button"]') as HTMLButtonElement | null;
const isDisabled = (b: HTMLButtonElement | null) => !!b?.disabled;

/**
 * A step may refuse to be approved without a transfer slip. The server is the authority, but a
 * screen that only discovers this by submitting an approval and rendering the refusal makes the
 * approver guess. These cover the explaining half.
 */
describe('review dialog: a step that requires a transfer slip', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    can.mockImplementation(() => true);
    canActApi.mockResolvedValue({ canAct: true });
    store.error = '';
    store.errorCode = undefined;
  });

  it('says nothing at all when the step asks for no slip', async () => {
    detail.mockResolvedValue(detailPayload());
    const w = await open();
    expect(el('[data-testid="slip-requirement"]')).toBeNull();
    expect(el('[data-testid="slip-uploaded-confirm"]')).toBeNull();
    expect(isDisabled(approveBtn())).toBe(false);
    w.unmount();
  });

  it('states the requirement and disables approve while no slip is attached', async () => {
    detail.mockResolvedValue(detailPayload({ slipRequired: true, hasSlip: false }));
    const w = await open();
    const panel = el('[data-testid="slip-requirement"]');
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute('data-satisfied')).toBe('no');
    expect(isDisabled(approveBtn())).toBe(true);
    w.unmount();
  });

  it('asks a later approver only to confirm, once the finance step uploaded the slip', async () => {
    detail.mockResolvedValue(detailPayload({ slipRequired: false, hasSlip: true }));
    const w = await open();
    expect(el('[data-testid="slip-uploaded-confirm"]')).not.toBeNull();
    expect(el('[data-testid="slip-requirement"]')).toBeNull();
    expect(isDisabled(approveBtn())).toBe(false);
    w.unmount();
  });

  it('leaves approve enabled once a slip is attached', async () => {
    detail.mockResolvedValue(detailPayload({ slipRequired: true, hasSlip: true }));
    const w = await open();
    expect(el('[data-testid="slip-requirement"]')?.getAttribute('data-satisfied')).toBe('yes');
    expect(isDisabled(approveBtn())).toBe(false);
    w.unmount();
  });

  it('re-reads the document when a slip is uploaded, so approve frees up without a reload', async () => {
    detail
      .mockResolvedValueOnce(detailPayload({ slipRequired: true, hasSlip: false }))
      .mockResolvedValue(detailPayload({ slipRequired: true, hasSlip: true }));
    const w = await open();
    expect(isDisabled(approveBtn())).toBe(true);

    (el('[data-testid="stub-upload"]') as HTMLElement).click();
    await flushPromises();

    expect(isDisabled(approveBtn())).toBe(false);
    w.unmount();
  });

  it('offers no upload control to an approver without PAYMENT_MANAGE', async () => {
    can.mockImplementation((code: string) => code !== 'PAYMENT_MANAGE');
    detail.mockResolvedValue(detailPayload({ slipRequired: true, hasSlip: false }));
    const w = await open();
    // The requirement is still stated — they need to know why they cannot approve.
    expect(el('[data-testid="slip-requirement"]')).not.toBeNull();
    expect(el('[data-testid="stub-upload"]')).toBeNull();
    w.unmount();
  });

  it('keeps reject and return available when the requirement is unmet', async () => {
    // Without this the gate is a trap: a document nobody can evidence could never leave approval.
    detail.mockResolvedValue(detailPayload({ slipRequired: true, hasSlip: false }));
    const w = await open();
    // By testid, not by label: the default locale in tests is Lao, and this assertion is about
    // which controls stay usable, not about their wording.
    const reject = el('[data-testid="reject-button"]') as HTMLButtonElement | null;
    const ret = el('[data-testid="return-button"]') as HTMLButtonElement | null;
    expect(reject).not.toBeNull();
    expect(ret).not.toBeNull();
    expect(isDisabled(reject)).toBe(false);
    expect(isDisabled(ret)).toBe(false);
    w.unmount();
  });

  it('re-reads after the server refuses for a missing slip, so the panel matches the refusal', async () => {
    // The race: someone deleted the slip after this dialog rendered.
    detail
      .mockResolvedValueOnce(detailPayload({ slipRequired: true, hasSlip: true }))
      .mockResolvedValue(detailPayload({ slipRequired: true, hasSlip: false }));
    act.mockImplementation(async () => {
      store.error = 'Step 4 requires a transfer slip before it can be approved.';
      store.errorCode = 'PAYMENT_SLIP_REQUIRED';
      return false;
    });
    const w = await open();
    expect(isDisabled(approveBtn())).toBe(false);

    approveBtn()!.click();
    await flushPromises();

    expect(detail).toHaveBeenCalledTimes(2);
    expect(el('[data-testid="slip-requirement"]')?.getAttribute('data-satisfied')).toBe('no');
    expect(isDisabled(approveBtn())).toBe(true);
    w.unmount();
  });
});

/**
 * What this document takes, and what is left in the pot it takes it from.
 *
 * Rendered where the decision is made — an approver signing it, and, because the transfer slip is
 * attached at an approval step, the person about to move the money. All three figures are decimal
 * STRINGS off the wire; the screen formats them and derives nothing.
 */
describe('review dialog: the budgets a document charges', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    can.mockImplementation(() => true);
    canActApi.mockResolvedValue({ canAct: true });
    store.error = '';
    store.errorCode = undefined;
  });

  const BUDGET = { id: 'b1', name: 'Utilities', amountTotal: '1000000', available: '750000', charged: '250000' };

  it('shows the pot, this document’s hold, and what is left', async () => {
    detail.mockResolvedValue(detailPayload({ budgets: [BUDGET] }));
    const w = await open();

    const block = el('[data-testid="document-budgets"]');
    expect(block).not.toBeNull();
    expect(el('[data-testid="document-budget-name"]')?.textContent).toContain('Utilities');
    expect(el('[data-testid="document-budget-charged"]')?.textContent).toMatch(/250,?000/);
    expect(el('[data-testid="document-budget-available"]')?.textContent).toMatch(/750,?000/);
    w.unmount();
  });

  it('shows nothing at all for a document that charges no budget', async () => {
    // An empty bordered box reads as a broken panel, so a type with requires_budget off gets none.
    detail.mockResolvedValue(detailPayload({ budgets: [] }));
    const w = await open();
    expect(el('[data-testid="document-budgets"]')).toBeNull();
    w.unmount();
  });

  it('one row per budget, however many the document charges', async () => {
    detail.mockResolvedValue(
      detailPayload({
        budgets: [BUDGET, { id: 'b2', name: 'Fuel', amountTotal: '500000', available: '100000', charged: '50000' }],
      }),
    );
    const w = await open();
    expect(document.body.querySelectorAll('[data-testid="document-budget"]')).toHaveLength(2);
    w.unmount();
  });

  it('marks a pot that is already overdrawn', async () => {
    // The one fact on this block that changes what the reader should do, so it is the one thing
    // drawn differently.
    detail.mockResolvedValue(detailPayload({ budgets: [{ ...BUDGET, available: '-25000' }] }));
    const w = await open();
    const cell = el('[data-testid="document-budget-available"]');
    expect(cell?.className).toMatch(/text-red/);
    w.unmount();
  });
});
