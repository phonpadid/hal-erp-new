/**
 * Which account code a document line's spending belongs to.
 *
 * One rule, read twice: `DocumentService` stamps the display code with it when the draft is
 * written, and `DocumentSubmitService` resolves it to the account the ledger will debit. They were
 * one expression in one method, which is why the posting could quietly disagree with the line for
 * as long as it read `budget.account_id` instead.
 *
 * The item is a BRANCH, not the first step of a fallback. A line naming an item takes that item's
 * per-company account or none at all: falling through to the document type would put a stationery
 * purchase on the type's default the day somebody forgot to map the item, which reads as configured
 * and is not.
 */
export function lineAccountCode(line: {
  /** True when the line names an item at all — distinct from that item having an account. */
  hasItem: boolean;
  /** `item_company.default_gl_account` for the active company. */
  itemGl?: string | null;
  /** `document_type.default_gl_account`. */
  typeDefault?: string | null;
  /** `budget.gl_account` — the last resort, and the only remaining read of it. */
  budgetGl?: string | null;
}): string | undefined {
  if (line.hasItem) return line.itemGl || undefined;
  return line.typeDefault || line.budgetGl || undefined;
}
