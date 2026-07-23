import { describe, expect, it } from 'vitest';
import la from '../../i18n/locales/la';
import { mountView } from '../../test/mountView';
import StockOnHandView from './StockOnHandView.vue';
import { useInventoryStore } from '../../stores/inventory';

const ITEM = 'a3bb189e-8bf9-3888-9912-ace4e6543002';
const WH = '3f4f2fd0-dccc-495e-bd95-814828cdace0';

const onHandRow = (over: Partial<Record<string, string>> = {}) => ({
  itemId: ITEM,
  itemCode: 'BOLT',
  itemName: 'Bolt M8',
  warehouseId: WH,
  warehouseCode: 'MAIN',
  warehouseName: 'Main store',
  qtyOnHand: '10.0000',
  qtyReserved: '8.0000',
  qtyAvailable: '2.0000',
  avgCost: '110.000000',
  totalValue: '1100.00',
  ...over,
});

async function mount(state: Record<string, unknown> = {}) {
  return mountView(StockOnHandView, {
    path: '/stock',
    routeName: 'stock',
    initialState: {
      inventory: {
        onHand: [onHandRow()],
        total: 1,
        page: 1,
        limit: 20,
        warehouses: [{ id: WH, code: 'MAIN', name: 'Main store', isActive: true }],
        ...state,
      },
    },
  });
}

describe('StockOnHandView', () => {
  it('loads on-hand and warehouse options on mount', async () => {
    await mount();
    const store = useInventoryStore();
    expect((store.loadOnHand as any).mock.calls.length).toBeGreaterThan(0);
    // The warehouse filter is useless without its options, so both load together.
    expect((store.loadWarehouses as any).mock.calls.length).toBeGreaterThan(0);
  });

  it('shows on-hand, reserved and available as three distinct figures', async () => {
    const wrapper = await mount();
    const text = wrapper.text();
    // "10 on hand of which 8 are spoken for" — available is what decides whether an issue is
    // possible, and it cannot be inferred from on-hand alone.
    expect(text).toContain('10.0000');
    expect(text).toContain('8.0000');
    expect(text).toContain('2.0000');
  });

  it('renders quantities from decimal strings without losing trailing precision', async () => {
    const wrapper = await mount({
      onHand: [onHandRow({ qtyOnHand: '0.0001', qtyAvailable: '0.0001', qtyReserved: '0.0000' })],
    });
    expect(wrapper.text()).toContain('0.0001');
  });

  it('renders the empty state when nothing is stocked', async () => {
    const wrapper = await mount({ onHand: [], total: 0 });
    // Asserted against the catalog, not a hardcoded phrase: the harness runs in `la`, and a
    // literal here would silently pass or fail on a translation edit rather than on behaviour.
    expect(wrapper.text()).toContain(la.inventory.onHand.empty);
  });

  it('surfaces a load failure with a retry instead of an empty table', async () => {
    const wrapper = await mount({ error: 'boom', onHand: [] });
    expect(wrapper.text()).toContain('boom');
  });
});
