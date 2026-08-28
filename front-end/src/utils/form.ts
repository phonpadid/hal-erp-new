import { Decimal } from 'decimal.js';
import type { FormFieldDef } from '../api/documents';

/** Names of required fields that have no non-empty value (client-side gate). */
export function validateRequired(
  fields: FormFieldDef[],
  values: Record<string, string | undefined>,
): string[] {
  return fields
    .filter((f) => f.isRequired)
    .filter((f) => {
      const v = values[f.id];
      return v === undefined || v === null || v === '';
    })
    .map((f) => f.fieldName);
}

/** Exact qty × unitPrice as a string — money is never a JS number. */
export function lineAmount(qty: string, unitPrice: string): string {
  return new Decimal(qty || '0').times(unitPrice || '0').toString();
}

/** A line is invalid when qty/unit price is negative or non-numeric (UX gate; server re-checks). */
export function lineInvalid(l: { qty: string; unitPrice: string }): boolean {
  return (
    Number(l.qty) < 0 ||
    Number(l.unitPrice) < 0 ||
    Number.isNaN(Number(l.qty)) ||
    Number.isNaN(Number(l.unitPrice))
  );
}

/**
 * Client mirror of the server's `requires_item` rule: on an item-mandatory type every line
 * must carry an item. UX-only; the server re-rejects at submit.
 */
export function lineMissingItem(l: { itemId?: string }, requiresItem: boolean): boolean {
  return requiresItem && !l.itemId;
}

/**
 * Client mirror of the server's complete-budget-coverage rule: a positive-amount line on a
 * `requires_budget` type must name a budget.
 *
 * It used to exempt item-backed lines, because their budget was resolved server-side from the
 * item's GL account. That resolution is gone — one account is charged by several budgets, so the
 * account cannot choose between them — and the exemption with it. Every line is checked now, which
 * is why `itemId` no longer appears in the condition.
 */
export function lineMissingBudget(
  l: { itemId?: string; budgetId?: string; qty: string; unitPrice: string },
  requiresBudget: boolean,
): boolean {
  return (
    requiresBudget && !l.budgetId && new Decimal(lineAmount(l.qty, l.unitPrice)).greaterThan(0)
  );
}

/**
 * A saved value the picker cannot offer back: a budget closed, an item withdrawn, a warehouse
 * deactivated since the draft was saved — or simply one belonging to a department this user's
 * pickers do not reach.
 *
 * A `Select` renders its PLACEHOLDER for a model value that is not among its options — which is
 * exactly what a field nobody ever filled looks like. The user re-picks it, saves, and whatever
 * else the load could not restore goes with it; that is how the day a spend happened gets dropped.
 * Reported as MISSING instead, so the screen says what happened rather than pretending nothing was
 * ever there.
 *
 * `ready` is whether the option list has finished loading, and it is a separate argument on
 * purpose. Inferring it from a non-empty list looked equivalent and was not: a user whose
 * department offers no budget at all gets an EMPTY list that has fully loaded, and that is the very
 * case this exists to report. Before a list has loaded, nothing is unavailable.
 */
export function unavailableValue(id: string | undefined, known: string[], ready: boolean): boolean {
  return !!id && ready && !known.includes(id);
}
