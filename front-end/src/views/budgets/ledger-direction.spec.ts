import { describe, expect, it } from 'vitest';
import { budgetTxnDirection } from '@erp/shared';

/**
 * The budget detail screen prints the ledger the summary above it is derived from. It used to draw
 * a settlement (`ACTUAL`) as a withdrawal, because the direction was a two-way Set and `ACTUAL` was
 * whatever the fallback bucket held. On the seeded Office Supplies budget the column summed to
 * −270,000 beside a budget that had fallen by 185,000 — every settled document deducted twice, and
 * a single 35,000 claim reading as 70,000 gone.
 *
 * The identity these tests pin is the arithmetic a reader performs when checking a history against
 * a summary:
 *
 *     Σ(signed ledger)  =  available − amount_total
 *
 * Asserted over the SIGNS THE LEDGER SHOWS, not over the raw rows: the defect was in what was
 * drawn, so a test that re-derived the sign from the data would have passed while the screen stayed
 * wrong.
 */

/** The sign the ledger renders for a row, per direction. */
const SIGN = { ADDS: 1, SUBTRACTS: -1, CONVERTS: 0 } as const;
const renderedSign = (txnType: string) => SIGN[budgetTxnDirection(txnType)];

/** Sum a whole ledger the way the screen shows it. */
const sumAsRendered = (entries: { txnType: string; amount: string }[]) =>
  entries.reduce((acc, e) => acc + renderedSign(e.txnType) * Number(e.amount), 0);

describe('ledger direction', () => {
  it('sorts every transaction type into one of three directions', () => {
    // Total over the enum on purpose. A type that gets its direction from a fallback bucket is how
    // ACTUAL became a deduction in the first place.
    expect(budgetTxnDirection('ADJUST_INCREASE')).toBe('ADDS');
    expect(budgetTxnDirection('TRANSFER_IN')).toBe('ADDS');
    expect(budgetTxnDirection('RELEASE')).toBe('ADDS');
    expect(budgetTxnDirection('ADJUST_DECREASE')).toBe('SUBTRACTS');
    expect(budgetTxnDirection('TRANSFER_OUT')).toBe('SUBTRACTS');
    expect(budgetTxnDirection('RESERVE')).toBe('SUBTRACTS');
    expect(budgetTxnDirection('ACTUAL')).toBe('CONVERTS');
  });

  it('treats an unknown type as a conversion, not as money moving', () => {
    // The safe default. A wrong ADDS/SUBTRACTS silently misstates the money; a wrong CONVERTS shows
    // an unsigned row and breaks the reconciliation below, which is a failure someone can see.
    expect(budgetTxnDirection('SOMETHING_ADDED_LATER')).toBe('CONVERTS');
    expect(renderedSign('SOMETHING_ADDED_LATER')).toBe(0);
  });

  it('reconciles the rendered ledger to the available balance', () => {
    // The seeded Office Supplies budget exactly as it stands on the running app.
    const amountTotal = 1_000_000;
    const available = 815_000;
    const ledger = [
      { txnType: 'ACTUAL', amount: '35000' }, // CLAIM-HAL-2026-0002
      { txnType: 'RESERVE', amount: '35000' }, // CLAIM-HAL-2026-0002
      { txnType: 'ACTUAL', amount: '50000' }, // PR-HAL-2026-0001
      { txnType: 'RESERVE', amount: '50000' }, // PROC-HAL-2026-0001
      { txnType: 'RESERVE', amount: '50000' }, // PR-HAL-2026-0001
      { txnType: 'RESERVE', amount: '50000' }, // CLAIM-HAL-2026-0001
    ];

    expect(sumAsRendered(ledger)).toBe(available - amountTotal);
    // The number the screen used to show, and the size of the error: Σ ACTUAL.
    expect(sumAsRendered(ledger)).not.toBe(-270_000);
  });

  it('accounts for a settled document once, not twice', () => {
    // Reserved 100,000, settled in full. Two entries, one deduction.
    const ledger = [
      { txnType: 'RESERVE', amount: '100000' },
      { txnType: 'ACTUAL', amount: '100000' },
    ];
    expect(sumAsRendered(ledger)).toBe(-100_000);
  });

  it('accounts for a partial settlement once, across all three of its entries', () => {
    // Reserved 100,000, settled for 90,000: ACTUAL 90,000 + RELEASE 10,000 (the unused remainder).
    // The budget must be down 90,000 — not 190,000, and not 180,000.
    const ledger = [
      { txnType: 'RESERVE', amount: '100000' },
      { txnType: 'ACTUAL', amount: '90000' },
      { txnType: 'RELEASE', amount: '10000' },
    ];
    expect(sumAsRendered(ledger)).toBe(-90_000);
  });

  it('reconciles a ledger that moves money in every direction', () => {
    // total 1,000,000 +50,000 −20,000 +30,000 −10,000 −200,000 +25,000 = 875,000, with a 150,000
    // settlement inside the reservation that must not move the total at all.
    const ledger = [
      { txnType: 'ADJUST_INCREASE', amount: '50000' },
      { txnType: 'ADJUST_DECREASE', amount: '20000' },
      { txnType: 'TRANSFER_IN', amount: '30000' },
      { txnType: 'TRANSFER_OUT', amount: '10000' },
      { txnType: 'RESERVE', amount: '200000' },
      { txnType: 'ACTUAL', amount: '150000' },
      { txnType: 'RELEASE', amount: '25000' },
    ];
    expect(sumAsRendered(ledger)).toBe(875_000 - 1_000_000);
  });
});
