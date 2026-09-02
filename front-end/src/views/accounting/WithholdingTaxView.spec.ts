import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountView } from '../../test/mountView';
import WithholdingTaxView from './WithholdingTaxView.vue';
import { useWhtStore } from '../../stores/wht';
import type { WhtCertificateRow } from '../../api/wht';
import type { VueWrapper } from '@vue/test-utils';

let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
});

const cert = (id: string, whtAmount: string): WhtCertificateRow => ({
  id,
  certificateNo: `WHT-2026-000${id.slice(-1)}`,
  vendor: { id: `v-${id}`, name: `Vendor ${id}` },
  taxCode: { id: 'tc', code: 'WHT3' },
  rate: '0.030000',
  baseAmount: '100000.00',
  whtAmount,
  issuedOn: '2026-04-05',
  remittanceId: null,
  remittedOn: null,
});

const CERTS = [cert('c-1', '3000.00'), cert('c-2', '1500.50')];

async function mount(permissions: string[], certificates = CERTS) {
  const w = await mountView(WithholdingTaxView, {
    path: '/withholding-tax',
    routeName: 'withholding-tax',
    permissions,
    initialState: { wht: { certificates, total: '4500.50' } },
  });
  await flushPromises();
  wrapper = w;
  return w;
}

const inBody = (testid: string) => document.body.querySelector(`[data-testid="${testid}"]`);

describe('WithholdingTaxView', () => {
  it('lists the outstanding certificates and their total', async () => {
    const text = (await mount(['TAX_VIEW'])).text();
    expect(text).toContain('WHT-2026-0001');
    expect(text).toContain('3,000.00');
    expect(text).toContain('1,500.50');
  });

  it('shows the outstanding total at the base currency places', async () => {
    const w = await mount(['TAX_VIEW']);
    expect(w.find('[data-testid="wht-total"]').text()).toBe('4,500.50');
  });

  it('offers no remit control without WHT_REMIT', async () => {
    const w = await mount(['TAX_VIEW']);
    expect(w.find('[data-testid="open-remit"]').exists()).toBe(false);
  });

  it('keeps the remit control disabled until certificates are selected', async () => {
    const w = await mount(['TAX_VIEW', 'WHT_REMIT']);
    const button = w.find('[data-testid="open-remit"]');
    expect(button.exists()).toBe(true);
    // Nothing selected: there is no total to clear, so there is nothing to post.
    expect((button.element as HTMLButtonElement).disabled).toBe(true);
  });

  it('remits exactly the selected certificates', async () => {
    const w = await mount(['TAX_VIEW', 'WHT_REMIT']);
    const store = useWhtStore();
    vi.mocked(store.remit).mockResolvedValue(true);

    // Select one of the two — the entry must clear that one's amount, not the account balance.
    await w.findComponent({ name: 'DataTable' }).vm.$emit('update:selection', [CERTS[1]]);
    await flushPromises();
    await w.find('[data-testid="open-remit"]').trigger('click');
    await flushPromises();

    // The dialog states the figure the entry will carry.
    expect(inBody('remit-explain')?.textContent).toContain('1,500.50');

    (inBody('confirm-remit') as HTMLElement).click();
    await flushPromises();
    expect(store.remit).toHaveBeenCalledTimes(1);
    expect(vi.mocked(store.remit).mock.calls[0][0]).toEqual(['c-2']);
  });

  it('shows the server refusal when a remittance is rejected', async () => {
    const w = await mount(['TAX_VIEW', 'WHT_REMIT']);
    const store = useWhtStore();
    const refusal = 'Already remitted: WHT-2026-0002';
    vi.mocked(store.remit).mockImplementation(async () => {
      store.error = refusal;
      return false;
    });

    await w.findComponent({ name: 'DataTable' }).vm.$emit('update:selection', [CERTS[0]]);
    await flushPromises();
    await w.find('[data-testid="open-remit"]').trigger('click');
    await flushPromises();
    (inBody('confirm-remit') as HTMLElement).click();
    await flushPromises();

    expect(store.error).toBe(refusal);
  });
});
