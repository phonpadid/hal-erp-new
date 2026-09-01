import { Migration } from '@mikro-orm/migrations';

/**
 * A stranded posting records WHICH budget stranded it.
 *
 * `gl_posting_attempt.last_error` already said so, in prose we wrote ourselves — which meant the
 * only way to re-queue exactly the postings one budget blocked was to parse that sentence back
 * apart. The cause belongs in a column.
 *
 * Set only when an attempt failed for a charged budget with no `account_id`, and cleared on every
 * other outcome, so it can never describe a cause that no longer applies. Two readers: naming a
 * budget's GL account re-queues the postings that budget blocked, and the undelivered-postings read
 * names the budget by joining rather than by re-deriving it from the message.
 *
 * `on delete set null`, not cascade: the attempt row must survive its budget. Losing which budget it
 * was costs an error message; deleting the attempt would lose the debt itself.
 *
 * Nullable with no backfill. Rows already `FAILED` for this cause keep a null here and stay exactly
 * as stranded as they were — the next attempt records the cause. Guessing which existing failure
 * was this one would be indistinguishable from having observed it.
 *
 * Hand-written for the same reason as `Migration20260903000000` and `Migration20260904000000`:
 * `migration:create` diffs the entities against the database and proposed, alongside these three
 * statements, dropping `stock_txn_qty_positive`, `budget_txn_budget_id_txn_date_index` and a dozen
 * attendance check constraints — drift between hand-written SQL and the entities, none of it this
 * change's business, and all of it real integrity on a live database.
 */
export class Migration20260905000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "gl_posting_attempt" add column "blocked_by_budget_id" uuid null;`,
    );
    this.addSql(
      `alter table "gl_posting_attempt" add constraint "gl_posting_attempt_blocked_by_budget_id_foreign" ` +
        `foreign key ("blocked_by_budget_id") references "budget" ("id") on update cascade on delete set null;`,
    );
    this.addSql(
      `create index "gl_posting_attempt_blocked_by_budget_id_index" on "gl_posting_attempt" ("blocked_by_budget_id");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop index "gl_posting_attempt_blocked_by_budget_id_index";`);
    this.addSql(
      `alter table "gl_posting_attempt" drop constraint "gl_posting_attempt_blocked_by_budget_id_foreign";`,
    );
    this.addSql(`alter table "gl_posting_attempt" drop column "blocked_by_budget_id";`);
  }
}
