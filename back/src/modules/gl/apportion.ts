import { Money } from '../../common/money/money';

/** One line's share of a budget's settlement: where it posts, and how much of the basis it carries. */
export interface ApportionableLine {
  /** The account this line's spending posts to. Lines sharing an account are summed. */
  accountId: string;
  /** `budget_base_line_amount` — the basis the budget was reserved and settled on. */
  basis: string;
}

/**
 * Split one budget's `ACTUAL` across the lines that charged it, pro rata by the basis it was cut on.
 *
 * `budget_txn` has no line reference — an ACTUAL row is per `(document, budget)` — and `settle` may
 * write an ACTUAL smaller than the reservation, releasing the difference. So the shares cannot be
 * the line amounts themselves; they are that amount scaled by what was actually settled.
 *
 * The weights and the amount being split are the same number (`budget_base_line_amount`), which is
 * what makes the expense side total exactly what the budget was cut by rather than approximately.
 *
 * **The residue goes to the largest line, not the last.** Rounding each share independently leaves
 * up to one minor unit unallocated, and giving it to whichever line happens to be read last would
 * make the entry depend on row order — two runs over the same data disagreeing by a satang, in an
 * append-only ledger.
 *
 * Returns an empty map when nothing has a basis. That is not an error: an imported spend carries no
 * line basis at all, and the caller posts the whole amount to the budget's own account instead.
 */
export function apportion(actual: string, lines: ApportionableLine[], decimalPlaces: number): Map<string, string> {
  const weighted = lines.filter((l) => Money.compare(l.basis, '0') > 0);
  const total = weighted.reduce((sum, l) => Money.add(sum, l.basis), '0');
  if (!weighted.length || Money.compare(total, '0') <= 0) return new Map();

  // Round each share down to the scale, then hand the difference to the largest line — one pass,
  // no drift, and the same answer whatever order the lines arrive in.
  const shares = weighted.map((l) => ({
    line: l,
    share: Money.round(Money.divide(Money.multiply(actual, l.basis), total), decimalPlaces),
  }));
  const allocated = shares.reduce((sum, s) => Money.add(sum, s.share), '0');
  const residue = Money.subtract(actual, allocated);
  if (Money.compare(residue, '0') !== 0) {
    let biggest = 0;
    for (let i = 1; i < shares.length; i += 1) {
      // Strictly greater, so ties keep the earliest — a deterministic answer either way.
      if (Money.compare(shares[i].line.basis, shares[biggest].line.basis) > 0) biggest = i;
    }
    shares[biggest].share = Money.add(shares[biggest].share, residue);
  }

  // Normalised to the currency's scale on the way out. `Money.add` returns the shortest form, so
  // accumulating would hand the ledger `600` where every other amount reads `600.00` — the same
  // money, written two ways, in a table people reconcile by eye.
  const byAccount = new Map<string, string>();
  for (const { line, share } of shares) {
    byAccount.set(line.accountId, Money.add(byAccount.get(line.accountId) ?? '0', share));
  }
  for (const [accountId, amount] of byAccount) {
    byAccount.set(accountId, Money.round(amount, decimalPlaces));
  }
  return byAccount;
}
