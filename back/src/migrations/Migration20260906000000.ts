import { Migration } from '@mikro-orm/migrations';

/**
 * A document line records the account its spending will post to.
 *
 * The ledger debited `budget.account_id` and nothing else, so the account a person configures where
 * the product asks for it — `item_company.default_gl_account`, `document_type.default_gl_account` —
 * never reached an entry, and one budget could debit exactly one account. `1.3 ຄ່າງວດລົດ` is loan
 * principal and interest, two accounts by any standard, and had to name one of them falsely.
 *
 * Stamped once at submit and never re-derived. An FK rather than the `gl_account` code beside it,
 * because re-deriving mutable configuration at payment time is how an item whose default GL is
 * edited after approval would clear a different account than the budget was cut on — silently, with
 * the entry still balancing. `accountByLineOf` recorded that objection; stamping at submit answers
 * it rather than ignoring it.
 *
 * Nullable with NO backfill, and the null is permanent, not a migration step waiting to be removed.
 * Every document submitted before this column carries none; `spend-import` writes lines directly;
 * and a chain settled through an ancestor reads that ancestor's lines. A null means "post the old
 * way" — fall back to the budget's account — so no settled document's entry changes.
 *
 * `on delete set null`, not cascade: a document line outlives the chart-of-accounts row it pointed
 * at. Losing which account it was costs the fallback; deleting the line would lose the spend.
 *
 * Hand-written, like `Migration20260903000000`, `Migration20260904000000` and
 * `Migration20260905000000`: `migration:create` diffs the entities against the database and
 * proposes, alongside these three statements, dropping `stock_txn_qty_positive`,
 * `budget_txn_budget_id_txn_date_index` and a dozen attendance check constraints — drift between
 * hand-written SQL and the entities, none of it this change's business, and all of it real
 * integrity on a live database.
 */
export class Migration20260906000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "document_line" add column "account_id" uuid null;`);
    this.addSql(
      `alter table "document_line" add constraint "document_line_account_id_foreign" ` +
        `foreign key ("account_id") references "account" ("id") on update cascade on delete set null;`,
    );
    this.addSql(
      `create index "document_line_account_id_index" on "document_line" ("account_id");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop index "document_line_account_id_index";`);
    this.addSql(`alter table "document_line" drop constraint "document_line_account_id_foreign";`);
    this.addSql(`alter table "document_line" drop column "account_id";`);
  }
}
