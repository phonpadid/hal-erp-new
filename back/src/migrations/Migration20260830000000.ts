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
 * The backfill below is deliberately narrow, and it is not the guess this column exists to remove.
 * The original version of this migration added the column NOT NULL with no backfill, on the stated
 * ground that nothing had launched — true of an empty database, and false of every database that
 * already carries a ledger, where the statement fails outright and the deploy stops mid-migration.
 *
 * `created_at` is a safe source here precisely because these rows were never backdated: each one was
 * written by the app inside the same transaction as the event it records, so its date IS the event's
 * date rather than an inference about it. That is checkable, not assumed — on the database this was
 * written for, all 31 pre-existing rows agree, to the day in `Asia/Bangkok`, with the
 * `submitted_at` of the document each row names. Two independently recorded timestamps, one answer.
 *
 * It cannot silently mis-date a row written after this point either: the backfill runs once, only
 * over rows that exist when the column is added, and every row written afterwards gets its
 * `txn_date` from the service that has the company's timezone in hand.
 */
export class Migration20260830000000 extends Migration {
  override async up(): Promise<void> {
    // Nullable first, so a database holding a ledger can be given dates before the constraint
    // that requires them. On an empty database every statement below is a no-op but the last.
    this.addSql(`alter table "budget_txn" add column "txn_date" date null;`);
    this.addSql(`
      update "budget_txn" t
         set "txn_date" = (t."created_at" at time zone coalesce(c."timezone", 'Asia/Bangkok'))::date
        from "document" d, "company" c
       where d."id" = t."document_id"
         and c."id" = d."company_id"
         and t."txn_date" is null
         and t."created_at" is not null;
    `);
    // `created_at` is nullable, so a row could still have no date to derive. Falling back to the
    // document's submit day keeps the ledger intact rather than failing the deploy over it.
    this.addSql(`
      update "budget_txn" t
         set "txn_date" = (coalesce(d."submitted_at", d."created_at", now())
                             at time zone coalesce(c."timezone", 'Asia/Bangkok'))::date
        from "document" d, "company" c
       where d."id" = t."document_id"
         and c."id" = d."company_id"
         and t."txn_date" is null;
    `);
    this.addSql(`alter table "budget_txn" alter column "txn_date" set not null;`);
    // The shape every as-of fold reads: this budget's rows up to a day.
    this.addSql(`create index "budget_txn_budget_id_txn_date_index" on "budget_txn" ("budget_id", "txn_date");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "budget_txn_budget_id_txn_date_index";`);
    this.addSql(`alter table "budget_txn" drop column "txn_date";`);
  }
}
