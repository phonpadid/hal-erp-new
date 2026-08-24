import { describe, expect, it } from 'vitest';
import { BudgetTxnType } from '../../common/enums';
import { attributeQuarters, elapsedDays, quarterOf, quartersOf } from './budget-period';
import type { AttributableTxn } from './budget-period';

const txn = (
  over: Partial<AttributableTxn> & Pick<AttributableTxn, 'txnType' | 'txnDate'>,
): AttributableTxn => ({
  documentId: 'doc-1',
  budgetId: 'bud-1',
  amount: '100',
  ...over,
});

describe('the quarters of a fiscal year', () => {
  it('runs from the year own start date, not from January', () => {
    // A company whose year starts in April has a Q1 of April–June. `fiscal_year.year` is a label;
    // `start_date` is the only thing that knows. A calendar assumption here would be wrong quietly,
    // for one company, in a figure nobody re-derives by hand.
    const q = quartersOf('2026-04-01');
    expect(q.map((x) => [x.start, x.end])).toEqual([
      ['2026-04-01', '2026-06-30'],
      ['2026-07-01', '2026-09-30'],
      ['2026-10-01', '2026-12-31'],
      ['2027-01-01', '2027-03-31'],
    ]);
  });

  it('covers a calendar year without a gap or an overlap', () => {
    const q = quartersOf('2026-01-01');
    expect(q.map((x) => [x.start, x.end])).toEqual([
      ['2026-01-01', '2026-03-31'],
      ['2026-04-01', '2026-06-30'],
      ['2026-07-01', '2026-09-30'],
      ['2026-10-01', '2026-12-31'],
    ]);
    expect(q.reduce((s, x) => s + x.days, 0)).toBe(365);
  });

  it('counts a leap year as 366 days', () => {
    expect(quartersOf('2028-01-01').reduce((s, x) => s + x.days, 0)).toBe(366);
  });

  it('clamps a year that starts on the 31st', () => {
    // 31 January + 3 months is 30 April, not 31 April.
    expect(quartersOf('2026-01-31')[1].start).toBe('2026-04-30');
  });
});

describe('placing a day in a quarter', () => {
  it('places a day in the right quarter of a calendar year', () => {
    expect(quarterOf('2026-01-01', '2026-01-01')).toBe(1);
    expect(quarterOf('2026-01-01', '2026-03-31')).toBe(1);
    expect(quarterOf('2026-01-01', '2026-04-01')).toBe(2);
    expect(quarterOf('2026-01-01', '2026-12-31')).toBe(4);
  });

  it('places April in Q1 of a year that starts in April', () => {
    expect(quarterOf('2026-04-01', '2026-04-05')).toBe(1);
    expect(quarterOf('2026-04-01', '2026-01-15')).toBeUndefined();
    expect(quarterOf('2026-04-01', '2027-02-15')).toBe(4);
  });

  it('returns nothing for a day outside the year', () => {
    expect(quarterOf('2026-01-01', '2025-12-31')).toBeUndefined();
    expect(quarterOf('2026-01-01', '2027-01-01')).toBeUndefined();
  });
});

describe('how much of a quarter has passed', () => {
  const q3 = quartersOf('2026-01-01')[2]; // 2026-07-01 → 2026-09-30, 92 days

  it('counts the elapsed days inclusively', () => {
    expect(q3.days).toBe(92);
    expect(elapsedDays(q3, '2026-07-01')).toBe(1);
    expect(elapsedDays(q3, '2026-08-09')).toBe(40);
  });

  it('never exceeds the quarter length', () => {
    expect(elapsedDays(q3, '2026-12-31')).toBe(92);
  });

  it('is zero before the quarter starts', () => {
    expect(elapsedDays(q3, '2026-06-30')).toBe(0);
  });
});

describe('attributing a ledger row to a quarter', () => {
  const FY = '2026-01-01';

  it('places a reserve and an actual by their own date', () => {
    const rows = [
      txn({ txnType: BudgetTxnType.RESERVE, txnDate: '2026-02-10' }),
      txn({ txnType: BudgetTxnType.ACTUAL, txnDate: '2026-05-10' }),
    ];
    const at = attributeQuarters(FY, rows);
    expect(at.get(rows[0])).toBe(1);
    expect(at.get(rows[1])).toBe(2);
  });

  it('returns a release to the quarter of the reserve it gives back', () => {
    // The decision this module exists for. By its own date the 30 would land in Q3, which
    // committed nothing — Q2 would report 100 it did not keep and Q3 would go negative.
    const reserve = txn({ txnType: BudgetTxnType.RESERVE, txnDate: '2026-05-20' });
    const release = txn({ txnType: BudgetTxnType.RELEASE, txnDate: '2026-07-04' });
    const at = attributeQuarters(FY, [reserve, release]);
    expect(at.get(reserve)).toBe(2);
    expect(at.get(release)).toBe(2);
  });

  it('follows the reserve of its OWN document and budget, not any reserve', () => {
    const mine = txn({ documentId: 'A', budgetId: 'B1', txnType: BudgetTxnType.RESERVE, txnDate: '2026-02-01' });
    const other = txn({ documentId: 'Z', budgetId: 'B1', txnType: BudgetTxnType.RESERVE, txnDate: '2026-11-01' });
    const release = txn({ documentId: 'A', budgetId: 'B1', txnType: BudgetTxnType.RELEASE, txnDate: '2026-09-09' });
    const at = attributeQuarters(FY, [mine, other, release]);
    expect(at.get(release)).toBe(1);
  });

  it('keeps a release in its own quarter when the reserve is in it too', () => {
    const reserve = txn({ txnType: BudgetTxnType.RESERVE, txnDate: '2026-02-01' });
    const release = txn({ txnType: BudgetTxnType.RELEASE, txnDate: '2026-03-01' });
    const at = attributeQuarters(FY, [reserve, release]);
    expect(at.get(release)).toBe(1);
  });

  it('falls back to its own date for a release with no reserve to point at', () => {
    // The ledger should never hold one. Dropping it would lose money silently; the fallback keeps
    // it visible in the quarter it happened.
    const orphan = txn({ txnType: BudgetTxnType.RELEASE, txnDate: '2026-08-01' });
    expect(attributeQuarters(FY, [orphan]).get(orphan)).toBe(3);
  });

  it('places adjustments and transfers by their own date', () => {
    const rows = [
      txn({ txnType: BudgetTxnType.ADJUST_INCREASE, txnDate: '2026-04-02' }),
      txn({ txnType: BudgetTxnType.TRANSFER_OUT, txnDate: '2026-10-02' }),
    ];
    const at = attributeQuarters(FY, rows);
    expect(at.get(rows[0])).toBe(2);
    expect(at.get(rows[1])).toBe(4);
  });

  it('never lets a quarter net below zero', () => {
    // The property the release rule buys, stated as arithmetic: a release is always attributed to
    // the quarter that holds its reserve, and it can never exceed it.
    const reserve = txn({ txnType: BudgetTxnType.RESERVE, txnDate: '2026-05-20', amount: '100' });
    const release = txn({ txnType: BudgetTxnType.RELEASE, txnDate: '2026-07-04', amount: '30' });
    const at = attributeQuarters(FY, [reserve, release]);
    const net = [1, 2, 3, 4].map((q) =>
      [reserve, release].reduce((s, t) => {
        if (at.get(t) !== q) return s;
        return t.txnType === BudgetTxnType.RELEASE ? s - Number(t.amount) : s + Number(t.amount);
      }, 0),
    );
    expect(net).toEqual([0, 70, 0, 0]);
    expect(net.every((n) => n >= 0)).toBe(true);
  });
});
