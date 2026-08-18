import { Migration } from '@mikro-orm/migrations';

/**
 * The budget ledger learns when its rows happened.
 *
 * This system keeps three append-only ledgers. `journal_entry` carries `entry_date` — the posting
 * company's own calendar day, by an enforced rule. `approval_log` carries `acted_at`. Even
 * `budget_movement`, which is an instruction rather than a ledger, carries `effective_date`.
 * `budget_txn` carried nothing but `created_at`, and that is nullable.
 *
 * The omission is not cosmetic. A budget figure could not be stated as of a date, so it could not be
 * reproduced tomorrow and a reconciliation could not be re-run for the month just closed. And with
 * no date on the row, nothing could tell a row that consumed one year's appropriation on a day
 * belonging to the next — the case that puts a permanent unexplained remainder in the
 * budget-to-ledger reconciliation every December.
 *
 * `txn_date` is the day of the EVENT, in the company's own timezone, by the same rule
 * `journal_entry.entry_date` uses. `created_at` stays and keeps its own job: when the system learned
 * of the row. The two differ whenever a backdated movement is approved, whenever a settlement is
 * recorded the next morning, and across every timezone boundary — the ledger needs both.
 *
 * No backfill. Nothing has launched, and deriving dates from `created_at` would write guesses and
 * give them the authority of stored data, which is the failure this column exists to remove.
 */
export class Migration20260830000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "budget_txn" add column "txn_date" date not null;`);
    // The shape every as-of fold reads: this budget's rows up to a day.
    this.addSql(`create index "budget_txn_budget_id_txn_date_index" on "budget_txn" ("budget_id", "txn_date");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "budget_txn_budget_id_txn_date_index";`);
    this.addSql(`alter table "budget_txn" drop column "txn_date";`);
  }
}
