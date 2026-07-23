import { afterEach, describe, expect, it } from 'vitest';
import la from '../../i18n/locales/la';
import { mountView } from '../../test/mountView';
import StockLedgerDialog from './StockLedgerDialog.vue';
import { useInventoryStore } from '../../stores/inventory';
import type { StockLedgerRow, StockOnHandRow, StockTxnType } from '../../api/inventory';

const ITEM = 'a3bb189e-8bf9-3888-9912-ace4e6543002';
const WH = '3f4f2fd0-dccc-495e-bd95-814828cdace0';
const DOC = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

const tick = () => new Promise((r) => setTimeout(r, 30));

const row: StockOnHandRow = {
  itemId: ITEM,
  itemCode: 'BOLT',
  itemName: 'Bolt M8',
  warehouseId: WH,
  warehouseCode: 'MAIN',
  warehouseName: 'Main store',
  qtyOnHand: '10.0000',
  qtyReserved: '0.0000',
  qtyAvailable: '10.0000',
  avgCost: '110.000000',
  totalValue: '1100.00',
};

const ledgerRow = (over: Partial<StockLedgerRow> = {}): StockLedgerRow => ({
  id: 'r1',
  txnType: 'RECEIVE' as StockTxnType,
  qty: '10.0000',
  unitCost: '110.000000',
  warehouseId: WH,
  warehouseCode: 'MAIN',
  balanceAfter: '10.0000',
  createdAt: '2026-07-22T00:00:00.000Z',
  ...over,
});

let wrapperUnderTest: any = null;

afterEach(() => {
  wrapperUnderTest?.unmount();
  wrapperUnderTest = null;
  document.body.innerHTML = '';
});

async function mount(ledger: StockLedgerRow[]) {
  wrapperUnderTest = await mountView(StockLedgerDialog, {
    path: '/stock',
    routeName: 'stock',
    props: { row },
    extraRoutes: [{ path: '/documents/:id', name: 'document-detail' }],
    initialState: {
      inventory: { ledger, ledgerTotal: ledger.length, ledgerPage: 1, ledgerLimit: 20 },
    },
  });
  await tick();
  return wrapperUnderTest;
}

describe('StockLedgerDialog', () => {
  it('loads the ledger for the row it is opened on', async () => {
    await mount([ledgerRow()]);
    const store = useInventoryStore();
    expect((store.loadLedger as any).mock.calls.length).toBeGreaterThan(0);
    expect((store.loadLedger as any).mock.calls[0][0]).toBe(ITEM);
  });

  it('shows the running balance after each movement', async () => {
    await mount([
      ledgerRow({ id: 'r1', qty: '10.0000', balanceAfter: '10.0000' }),
      ledgerRow({ id: 'r2', txnType: 'ISSUE', qty: '4.0000', balanceAfter: '6.0000' }),
    ]);
    // The balance column is what makes a surprising figure traceable to the movement that caused it.
    expect(document.body.textContent).toContain('6.0000');
  });

  it('signs quantities so direction reads at a glance', async () => {
    await mount([
      ledgerRow({ id: 'r1', txnType: 'RECEIVE', qty: '10.0000' }),
      ledgerRow({ id: 'r2', txnType: 'ISSUE', qty: '4.0000', balanceAfter: '6.0000' }),
    ]);
    const text = document.body.textContent ?? '';
    // Stored positive, displayed signed — direction lives in the type, not in the number.
    expect(text).toContain('+10.0000');
    expect(text).toContain('−4.0000');
  });

  it('marks a reservation as availability-only', async () => {
    await mount([ledgerRow({ id: 'r1', txnType: 'RESERVE', qty: '4.0000', unitCost: undefined })]);
    // A reader scanning the quantity column would otherwise read RESERVE as stock arriving and
    // then wonder why the balance never moved.
    expect(document.body.textContent).toContain(la.inventory.ledger.availabilityOnly);
  });

  it('links a movement to the document that caused it', async () => {
    await mount([ledgerRow({ documentId: DOC, docNo: 'ISS-0001' })]);
    // The harness stubs RouterLink to a bare <a> with no href, so what is assertable here is
    // that the movement renders as a link carrying the document's number — the affordance that
    // makes a surprising balance traceable. The destination itself is covered by the route table.
    const link = [...document.querySelectorAll('a')].find((a) =>
      (a.textContent ?? '').includes('ISS-0001'),
    );
    expect(link, 'the movement should render as a link to its source document').toBeTruthy();
  });

  it('renders the empty state when the item has never moved', async () => {
    await mount([]);
    expect(document.body.textContent).toContain(la.inventory.ledger.empty);
  });
});
