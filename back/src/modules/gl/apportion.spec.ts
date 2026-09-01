import { describe, expect, it } from 'vitest';
import { Money } from '../../common/money/money';
import { apportion, type ApportionableLine } from './apportion';

const sum = (m: Map<string, string>) => [...m.values()].reduce((a, b) => Money.add(a, b), '0');
/** Money equality, not string equality: `600` and `600.00` are the same amount. */
const isAmount = (actual: string, expected: string) => Money.compare(actual, expected) === 0;

/**
 * The arithmetic the expense side rests on.
 *
 * Every entry must debit exactly what the budget was cut by. `budget_txn` records the settlement per
 * `(document, budget)` with no line reference, and a partial settlement writes an ACTUAL smaller
 * than the reservation — so the split is derived, and a derivation that loses a satang loses it in
 * an append-only ledger.
 */
describe('apportion', () => {
  it('splits pro rata by the basis the budget was cut on', () => {
    const lines: ApportionableLine[] = [
      { accountId: '5210', basis: '600' },
      { accountId: '5300', basis: '400' },
    ];
    const out = apportion('1000', lines, 2);
    expect(out.get('5210')).toBe('600.00');
    expect(out.get('5300')).toBe('400.00');
  });

  it('sums lines that share an account', () => {
    const out = apportion('1000', [
      { accountId: '5210', basis: '300' },
      { accountId: '5210', basis: '700' },
    ], 2);
    expect([...out.keys()]).toEqual(['5210']);
    expect(out.get('5210')).toBe('1000.00');
  });

  it('scales every share when the settlement is partial', () => {
    // Reserved 1000 across 600/400, settled 500 and released the rest.
    const out = apportion('500', [
      { accountId: '5210', basis: '600' },
      { accountId: '5300', basis: '400' },
    ], 2);
    expect(out.get('5210')).toBe('300.00');
    expect(out.get('5300')).toBe('200.00');
    expect(isAmount(sum(out), '500')).toBe(true);
  });

  it('gives the rounding residue to the largest line, not the last', () => {
    // 100 over three equal thirds in a currency with no minor unit: 33 + 33 + 33 leaves 1.
    const equal: ApportionableLine[] = [
      { accountId: 'a', basis: '1' },
      { accountId: 'b', basis: '1' },
      { accountId: 'c', basis: '1' },
    ];
    expect(isAmount(sum(apportion('100', equal, 0)), '100')).toBe(true);

    // With one line clearly largest, the residue lands on it whatever the order.
    const uneven: ApportionableLine[] = [
      { accountId: 'small', basis: '1' },
      { accountId: 'big', basis: '2' },
    ];
    const a = apportion('100', uneven, 0);
    const b = apportion('100', [...uneven].reverse(), 0);
    expect(a).toEqual(b);
    expect(isAmount(sum(a), '100')).toBe(true);
    expect(Money.compare(a.get('big')!, a.get('small')!)).toBe(1);
  });

  it('returns nothing when no line carries a basis', () => {
    // An imported spend: the caller posts the whole amount to the budget's own account instead.
    expect(apportion('1000', [], 2).size).toBe(0);
    expect(apportion('1000', [{ accountId: '5210', basis: '0' }], 2).size).toBe(0);
  });

  it('ignores lines with no basis while splitting the rest', () => {
    const out = apportion('1000', [
      { accountId: '5210', basis: '600' },
      { accountId: '5300', basis: '400' },
      { accountId: '5400', basis: '0' },
    ], 2);
    expect(out.has('5400')).toBe(false);
    expect(isAmount(sum(out), '1000')).toBe(true);
  });

  it('always totals the input, whatever the amounts and the order', () => {
    // The property that matters: the entry balances because the expense side is exactly the cut.
    let seed = 12345;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return (seed % n) + 1;
    };
    for (let run = 0; run < 300; run += 1) {
      const dp = [0, 2, 3][run % 3];
      const lines: ApportionableLine[] = Array.from({ length: rnd(6) }, (_, i) => ({
        accountId: `acct-${rnd(3)}`,
        basis: String(rnd(100000)),
        __i: i,
      })) as ApportionableLine[];
      const actual = String(rnd(5000000));
      const out = apportion(actual, lines, dp);
      expect(isAmount(sum(out), actual)).toBe(true);
      // Order-independence: the same lines shuffled produce the same map.
      expect(apportion(actual, [...lines].reverse(), dp)).toEqual(out);
    }
  });
});
