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
