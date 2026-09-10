import { Migration } from '@mikro-orm/migrations';

/**
 * An item's per-company default becomes a BUDGET, held as its place in the plan.
 *
 * `item_company` could only say which account an item posts to, and one account carries many
 * budgets — at HAL Logistic `612.06` is the account of 6.101, 6.102, 6.103 and 6.107 alike — so an
 * admin who meant one of them had nothing narrower to record. This column records the budget by its
 * plan code, never by `budget.id`: `budget` and `budget_node` are both keyed by fiscal year, and a
 * stored id would name a closed year's row the moment a new year opened. `budget_node` is unique on
 * `(fiscal_year_id, code)` and `budget.node_id` is unique, so within the open year a code resolves
 * to exactly one budget — and keeps resolving, year after year, with nothing to re-point.
 *
 * A varchar rather than a foreign key for that same reason: the row it names is a different row
 * each year, so there is no one row to reference. Company isolation comes through the fiscal year,
 * which is company-scoped — a code is only ever looked up inside the active company's open year.
 *
 * Nothing is back-filled. An account cannot be resolved back into one of the several budgets that
 * share it, and guessing would record a binding nobody chose — which is the very ambiguity this
 * removes. Items already carrying an account keep it and keep posting; `default_gl_account` is
 * still the column documents and journal entries read.
 */
export class Migration20260910000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "item_company" add column if not exists "default_budget_code" varchar(255) null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "item_company" drop column if exists "default_budget_code";`);
  }
}
