import { Migration } from '@mikro-orm/migrations';

/**
 * Record WHEN a line was received, not only how much.
 *
 * `document_line.received_qty` is a running total with no time attached, so "how much had been
 * received as at the 30th" — the question a period-close accrual asks — could not be answered from
 * it. Stock-tracked lines have `stock_txn.created_at` to fall back on; a service or an untracked
 * consumable produces no stock movement and had nothing at all.
 *
 * Nullable, and left null for every existing row: a receipt recorded before this column existed
 * happened at a time nobody wrote down, and inventing one would be a guess dressed as data. The
 * accrual treats a null as "received at some unknown point in the past", which keeps those lines
 * counted rather than silently dropped.
 */
export class Migration20260815000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "document_line" add column "last_received_at" timestamptz null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "document_line" drop column "last_received_at";`);
  }
}
