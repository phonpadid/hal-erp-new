import { describe, expect, it } from 'vitest';
import { BudgetTxnType } from '../../common/enums';
import {
  attributeMonths,
  attributeQuarters,
  elapsedDays,
  monthOf,
  monthsOf,
  quarterOf,
  quarterOfMonth,
  quartersOf,
} from './budget-period';
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
    const reserve = txn({
      txnType: BudgetTxnType.RESERVE,
      txnDate: '2026-05-20',
    });
    const release = txn({
      txnType: BudgetTxnType.RELEASE,
      txnDate: '2026-07-04',
    });
    const at = attributeQuarters(FY, [reserve, release]);
    expect(at.get(reserve)).toBe(2);
    expect(at.get(release)).toBe(2);
  });

  it('follows the reserve of its OWN document and budget, not any reserve', () => {
    const mine = txn({
      documentId: 'A',
      budgetId: 'B1',
      txnType: BudgetTxnType.RESERVE,
      txnDate: '2026-02-01',
    });
    const other = txn({
      documentId: 'Z',
      budgetId: 'B1',
      txnType: BudgetTxnType.RESERVE,
      txnDate: '2026-11-01',
    });
    const release = txn({
      documentId: 'A',
      budgetId: 'B1',
      txnType: BudgetTxnType.RELEASE,
      txnDate: '2026-09-09',
    });
    const at = attributeQuarters(FY, [mine, other, release]);
    expect(at.get(release)).toBe(1);
  });

  it('keeps a release in its own quarter when the reserve is in it too', () => {
    const reserve = txn({
      txnType: BudgetTxnType.RESERVE,
      txnDate: '2026-02-01',
    });
    const release = txn({
      txnType: BudgetTxnType.RELEASE,
      txnDate: '2026-03-01',
    });
    const at = attributeQuarters(FY, [reserve, release]);
    expect(at.get(release)).toBe(1);
  });

  it('falls back to its own date for a release with no reserve to point at', () => {
    // The ledger should never hold one. Dropping it would lose money silently; the fallback keeps
    // it visible in the quarter it happened.
    const orphan = txn({
      txnType: BudgetTxnType.RELEASE,
      txnDate: '2026-08-01',
    });
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
    const reserve = txn({
      txnType: BudgetTxnType.RESERVE,
      txnDate: '2026-05-20',
      amount: '100',
    });
    const release = txn({
      txnType: BudgetTxnType.RELEASE,
      txnDate: '2026-07-04',
      amount: '30',
    });
    const at = attributeQuarters(FY, [reserve, release]);
    const net = [1, 2, 3, 4].map((q) =>
      [reserve, release].reduce((s, t) => {
        if (at.get(t) !== q) return s;
        return t.txnType === BudgetTxnType.RELEASE
          ? s - Number(t.amount)
          : s + Number(t.amount);
      }, 0),
    );
    expect(net).toEqual([0, 70, 0, 0]);
    expect(net.every((n) => n >= 0)).toBe(true);
  });
});

describe('the months of a fiscal year', () => {
  it('runs from the year own start date, not from January', () => {
    const m = monthsOf('2026-04-01');
    expect(m[0]).toMatchObject({
      month: 1,
      quarter: 1,
      start: '2026-04-01',
      end: '2026-04-30',
    });
    expect(m[11]).toMatchObject({
      month: 12,
      quarter: 4,
      start: '2027-03-01',
      end: '2027-03-31',
    });
  });

  it('lands its boundaries ON the quarter boundaries', () => {
    // The property the whole monthly figure rests on. Months 1–3 must fill Q1 exactly; if a month
    // straddled a quarter edge, three monthly figures could never sum to their quarter.
    for (const start of [
      '2026-01-01',
      '2026-04-01',
      '2026-07-15',
      '2026-01-31',
    ]) {
      const q = quartersOf(start);
      const m = monthsOf(start);
      for (const w of q) {
        const mine = m.filter((x) => x.quarter === w.quarter);
        expect(mine).toHaveLength(3);
        expect(mine[0].start).toBe(w.start);
        expect(mine[2].end).toBe(w.end);
        expect(mine.reduce((s, x) => s + x.days, 0)).toBe(w.days);
      }
    }
  });

  it('covers the year without a gap or an overlap', () => {
    const m = monthsOf('2026-01-01');
    expect(m.reduce((s, x) => s + x.days, 0)).toBe(365);
    for (let i = 1; i < m.length; i++) {
      const prevEnd = new Date(`${m[i - 1].end}T00:00:00.000Z`).getTime();
      const start = new Date(`${m[i].start}T00:00:00.000Z`).getTime();
      expect(start - prevEnd).toBe(24 * 60 * 60 * 1000);
    }
  });
});

describe('placing a day in a fiscal month', () => {
  it('places April in month 1 of a year that starts in April', () => {
    // The reason the index is a POSITION and not a calendar month: April is month 4 of the
    // calendar and month 1 of this year, and reading `txn_date.getMonth()` would file it under a
    // month belonging to another quarter.
    expect(monthOf('2026-04-01', '2026-04-15')).toBe(1);
    expect(monthOf('2026-04-01', '2027-03-31')).toBe(12);
  });

  it('places a day in the right month of a calendar year', () => {
    expect(monthOf('2026-01-01', '2026-01-01')).toBe(1);
    expect(monthOf('2026-01-01', '2026-08-25')).toBe(8);
    expect(monthOf('2026-01-01', '2026-12-31')).toBe(12);
  });

  it('returns nothing for a day outside the year', () => {
    expect(monthOf('2026-01-01', '2025-12-31')).toBeUndefined();
    expect(monthOf('2026-01-01', '2027-01-01')).toBeUndefined();
  });
});

describe('attributing a ledger row to a fiscal month', () => {
  const FY = '2026-01-01';

  it('places a reserve and an actual by their own date', () => {
    const rows = [
      txn({ txnType: BudgetTxnType.RESERVE, txnDate: '2026-02-10' }),
      txn({ txnType: BudgetTxnType.ACTUAL, txnDate: '2026-05-10' }),
    ];
    const at = attributeMonths(FY, rows);
    expect(at.get(rows[0])).toBe(2);
    expect(at.get(rows[1])).toBe(5);
  });

  it('returns a release to the month of the reserve it gives back', () => {
    const reserve = txn({
      txnType: BudgetTxnType.RESERVE,
      txnDate: '2026-05-20',
    });
    const release = txn({
      txnType: BudgetTxnType.RELEASE,
      txnDate: '2026-07-04',
    });
    const at = attributeMonths(FY, [reserve, release]);
    expect(at.get(reserve)).toBe(5);
    expect(at.get(release)).toBe(5);
  });

  it('agrees with the quarter attribution on every row', () => {
    // The invariant that lets three monthly figures sum to their quarter: whatever month a row is
    // filed in, that month belongs to the quarter the row was filed in. Stated over a set that
    // includes the case the two rules could most easily disagree on — a release whose own date is
    // in a different quarter from its reserve.
    const rows = [
      txn({
        documentId: 'A',
        txnType: BudgetTxnType.RESERVE,
        txnDate: '2026-05-20',
      }),
      txn({
        documentId: 'A',
        txnType: BudgetTxnType.RELEASE,
        txnDate: '2026-07-04',
      }),
      txn({
        documentId: 'B',
        txnType: BudgetTxnType.RESERVE,
        txnDate: '2026-01-02',
      }),
      txn({
        documentId: 'B',
        txnType: BudgetTxnType.ACTUAL,
        txnDate: '2026-11-30',
      }),
      txn({
        documentId: 'C',
        txnType: BudgetTxnType.RELEASE,
        txnDate: '2026-09-09',
      }),
    ];
    const months = attributeMonths(FY, rows);
    const quarters = attributeQuarters(FY, rows);
    for (const r of rows) {
      const m = months.get(r);
      expect(m).toBeDefined();
      expect(quarterOfMonth(m!)).toBe(quarters.get(r));
    }
  });

  it('falls back to its own date for a release with no reserve to point at', () => {
    const orphan = txn({
      txnType: BudgetTxnType.RELEASE,
      txnDate: '2026-08-01',
    });
    expect(attributeMonths(FY, [orphan]).get(orphan)).toBe(8);
  });

  it('never lets a month net below zero', () => {
    const reserve = txn({
      txnType: BudgetTxnType.RESERVE,
      txnDate: '2026-05-20',
      amount: '100',
    });
    const release = txn({
      txnType: BudgetTxnType.RELEASE,
      txnDate: '2026-07-04',
      amount: '30',
    });
    const at = attributeMonths(FY, [reserve, release]);
    const net = Array.from({ length: 12 }, (_, i) => i + 1).map((m) =>
      [reserve, release].reduce((s, t) => {
        if (at.get(t) !== m) return s;
        return t.txnType === BudgetTxnType.RELEASE
          ? s - Number(t.amount)
          : s + Number(t.amount);
      }, 0),
    );
    expect(net[4]).toBe(70);
    expect(net.every((n) => n >= 0)).toBe(true);
  });
});
