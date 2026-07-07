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
