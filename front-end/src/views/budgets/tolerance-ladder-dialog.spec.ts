import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import ToastService from 'primevue/toastservice';
import ConfirmationService from 'primevue/confirmationservice';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import ToleranceLadderDialog from './ToleranceLadderDialog.vue';
import type { ToleranceRung } from '../../api/budgets';

/**
 * The ladder editor refuses exactly what `ToleranceLadder.parse` refuses and nothing more. The
 * "nothing more" half is the load-bearing one: every matched rung applies and a matched BLOCK
 * beats a matched WARN, so order carries no meaning to the server — which is why a client that
 * sorted or deduplicated would save a ladder differing from the one the person reviewed.
 */
const updateMock = vi.fn();
vi.mock('../../api/budgets', () => ({
  budgetsApi: { updateControlPoint: (...a: unknown[]) => updateMock(...a) },
}));

beforeAll(() => {
  i18n.global.locale.value = 'en';
});
afterAll(() => {
  i18n.global.locale.value = 'la';
});

let wrapper: VueWrapper | undefined;
afterEach(() => {
  // PrimeVue's Dialog teleports to document.body and outlives the wrapper otherwise — the next
  // test would then query a dead dialog left by this one.
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
});

function open(props: { tolerance?: ToleranceRung[]; ceiling?: string | null } = {}) {
  const pinia = createPinia();
  setActivePinia(pinia);
  wrapper = mount(ToleranceLadderDialog, {
    props: {
      visible: true,
      controlPointId: 'cp1',
      tolerance: props.tolerance ?? [{ at: 100, action: 'BLOCK' }],
      ceiling: props.ceiling ?? '23056000',
    },
    global: { plugins: [i18n, PrimeVue, ToastService, ConfirmationService, pinia] },
    attachTo: document.body,
  });
  return wrapper;
}

const el = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const all = (id: string) => document.querySelectorAll(`[data-testid="${id}"]`);
const saveBtn = () => el('save-ladder') as HTMLButtonElement;
const click = async (node: HTMLElement | null) => {
  expect(node, 'element is on screen').toBeTruthy();
  node!.click();
  await flushPromises();
};

beforeEach(() => {
  vi.clearAllMocks();
  updateMock.mockResolvedValue({ id: 'cp1', tolerance: [{ at: 100, action: 'WARN' }] });
});

describe('the ladder editor refuses what the server refuses', () => {
  it('refuses an empty ladder before calling the server', async () => {
    open();
    await flushPromises();
    await click(el('remove-rung'));
    expect(el('empty-ladder')).toBeTruthy();
    expect(saveBtn().disabled).toBe(true);
    await click(saveBtn());
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('refuses a negative threshold before calling the server', async () => {
    open({ tolerance: [{ at: -1, action: 'BLOCK' }] });
    await flushPromises();
    expect(saveBtn().disabled).toBe(true);
    await click(saveBtn());
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('allows a threshold above 100 — an allowance, not a mistake', async () => {
    open({ tolerance: [{ at: 120, action: 'WARN' }] });
    await flushPromises();
    expect(saveBtn().disabled).toBe(false);
  });
});

describe('the ladder editor does not rewrite what it was given', () => {
  it('sends the rungs in the order they were entered', async () => {
    const entered: ToleranceRung[] = [
      { at: 100, action: 'BLOCK' },
      { at: 90, action: 'WARN' },
    ];
    open({ tolerance: entered });
    await flushPromises();
    await click(saveBtn());
    expect(updateMock).toHaveBeenCalledWith('cp1', { tolerance: entered });
  });
});

describe('a ladder that would refuse everything is called out, not blocked', () => {
  it('warns when a BLOCK rung meets a zero ceiling', async () => {
    open({ ceiling: '0', tolerance: [{ at: 100, action: 'BLOCK' }] });
    await flushPromises();
    expect(el('refuses-everything')).toBeTruthy();
    // Said, never prevented: a deliberately frozen line is a legitimate configuration, and only
    // the person saving knows whether this is one.
    expect(saveBtn().disabled).toBe(false);
  });

  it('does not warn when the same zero ceiling carries only a WARN rung', async () => {
    open({ ceiling: '0.00', tolerance: [{ at: 100, action: 'WARN' }] });
    await flushPromises();
    expect(el('refuses-everything')).toBeNull();
  });

  it('does not warn when the ceiling is real money', async () => {
    open({ ceiling: '23056000', tolerance: [{ at: 100, action: 'BLOCK' }] });
    await flushPromises();
    expect(el('refuses-everything')).toBeNull();
  });
});

describe('a refused save keeps the work on screen', () => {
  it('shows the server message and leaves the dialog open with the entered rungs', async () => {
    updateMock.mockRejectedValueOnce({
      response: { data: { message: 'tolerance ladder[0].at must be a finite percentage' } },
    });
    const w = open();
    await flushPromises();
    await click(el('add-rung'));
    await click(saveBtn());

    expect(el('ladder-server-error')?.textContent).toContain('finite percentage');
    // Both rungs still on screen, and the dialog never asked to close.
    expect(all('ladder-rung')).toHaveLength(2);
    expect(w.emitted('update:visible')).toBeUndefined();
  });
});
