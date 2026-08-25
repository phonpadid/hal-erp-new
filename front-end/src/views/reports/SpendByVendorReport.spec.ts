import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import type { VueWrapper } from '@vue/test-utils';
import { mountView } from '../../test/mountView';
import SpendByVendorReport from './SpendByVendorReport.vue';

let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
});

const PERMS = ['REPORT_VIEW'];

/**
 * `v-if="!loading && !hasData"` with a bare `v-else` has no branch for "still asking": both
 * sides read false while the request is in flight, so the data branch mounted and the chart
 * initialised against a canvas that was about to be replaced. That is where the console's
 * `Failed to create chart: can't acquire context` came from, and why the screen drew a chart
 * as though the request had already returned.
 */
async function mount(state: Record<string, unknown>) {
  const w = await mountView(SpendByVendorReport, {
    path: '/reports/spend-by-vendor',
    routeName: 'report-spend-by-vendor',
    permissions: PERMS,
    initialState: {
      reports: { spend: [], loading: false, error: '', ...state },
      auth: { permissions: PERMS, baseCurrency: { code: 'LAK', decimalPlaces: 0 } },
    },
  });
  await flushPromises();
  wrapper = w;
  return w;
}

describe('SpendByVendorReport', () => {
  it('mounts no chart while the request is in flight', async () => {
    const w = await mount({ loading: true, spend: [] });
    expect(w.find('canvas').exists()).toBe(false);
    expect(w.text()).toContain('ກຳລັງໂຫຼດ');
  });

  it('says there is nothing, with a reason, once the request returns empty', async () => {
    const w = await mount({ loading: false, spend: [] });
    expect(w.find('canvas').exists()).toBe(false);
    // EmptyState requires both a title and a message; this view used to pass only a title.
    expect(w.text()).toContain('ບໍ່ມີເອກະສານໃນຊ່ວງນີ້ທີ່ບັນທຶກລາຍຈ່າຍໃສ່ຜູ້ຂາຍ');
  });

  it('draws the chart once there is data', async () => {
    const w = await mount({
      loading: false,
      spend: [{ vendorId: 'v1', vendorName: 'ຜູ້ຂາຍ ກ', count: 2, baseTotal: '1000', cumulativePct: 100 }],
    });
    expect(w.findComponent({ name: 'ParetoChart' }).exists()).toBe(true);
  });
});
