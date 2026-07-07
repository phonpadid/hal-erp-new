import { Decimal } from 'decimal.js';
import type { BalanceBreakdown } from '../../api/budgets';

/**
 * Budget balance waterfall — a presentational view of the derived breakdown.
 *
 * The steps mirror the server's derived-balance order (invariant 3):
 *   amountTotal + adjustIncrease − adjustDecrease + transferIn − transferOut
 *   − reserved − actual + released = available
 * so the running balance after the last movement always reconciles to `available`.
 *
 * Money stays a decimal string everywhere it is displayed; we only convert to a JS
 * number for the floating-bar geometry (`range`), never for a figure shown to the user.
 */
export type WaterfallKind = 'start' | 'increase' | 'decrease' | 'available';

export interface WaterfallStep {
  /** breakdown key, also the i18n label key under `budgets.balance.*` */
  key: string;
  kind: WaterfallKind;
  /** display magnitude as a decimal string (never a JS number) */
  amount: string;
  /** [start, end] running-balance geometry for the floating bar */
  range: [number, number];
}

// Movements applied to the running balance, in the exact derivation order and signs
// used by BudgetDetailView's numeric breakdown — the two can never drift.
const DELTAS: Array<{ key: keyof BalanceBreakdown; sign: 1 | -1 }> = [
  { key: 'adjustIncrease', sign: 1 },
  { key: 'adjustDecrease', sign: -1 },
  { key: 'transferIn', sign: 1 },
  { key: 'transferOut', sign: -1 },
  { key: 'reserved', sign: -1 },
  { key: 'actual', sign: -1 },
  { key: 'released', sign: 1 },
];

/**
 * Build the ordered waterfall steps for a breakdown. The first bar floats from 0 to
 * the total; each movement floats from the prior running balance to the new one; the
 * final `available` bar is grounded at zero as the result. Zero-magnitude movements are
 * omitted so the journey stays legible — the reconciliation to `available` is unaffected.
 */
export function buildWaterfallSteps(b: BalanceBreakdown): WaterfallStep[] {
  const steps: WaterfallStep[] = [];
  let running = new Decimal(b.amountTotal || '0');
  steps.push({ key: 'amountTotal', kind: 'start', amount: running.toString(), range: [0, running.toNumber()] });

  for (const { key, sign } of DELTAS) {
    const magnitude = new Decimal((b[key] as string) || '0');
    if (magnitude.isZero()) continue;
    const next = running.plus(magnitude.times(sign));
    steps.push({
      key,
      kind: sign > 0 ? 'increase' : 'decrease',
      amount: magnitude.toString(),
      range: [running.toNumber(), next.toNumber()],
    });
    running = next;
  }

  steps.push({ key: 'available', kind: 'available', amount: b.available, range: [0, new Decimal(b.available || '0').toNumber()] });
  return steps;
}
