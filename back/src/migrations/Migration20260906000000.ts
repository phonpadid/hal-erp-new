import { Migration } from '@mikro-orm/migrations';

/**
 * `transfer_from` — which of the company's own accounts a transfer left.
 *
 * On TWO tables, because the fact is stated before the row that finally holds it exists.
 * `payment_attachment.transfer_from` is where the person uploading the transfer slip says it, which
 * in practice is during approval, when no `payment` row has been written yet. `payment.transfer_from`
 * is the recorded payment's own statement, adopted from the slip when the payment is recorded — the
 * same adoption the slip itself already goes through. Neither is derived from a configured
 * `bank_account`; see below.
 *
 * The company runs a main account and a reserve account, and which one paid is a fact somebody
 * confirms at the moment of paying. `payment` already records how the money moved (`method`), what
 * identifies the movement at the bank (`reference`), and — for a payment produced by a bank run —
 * the configured `bank_account_id` that run named. A hand-recorded transfer had nowhere to say it.
 *
 * Text with a CHECK rather than a foreign key, deliberately. `bank_account` holds no rows in
 * practice, so a column pointing at it would be a column nobody can fill; this one records what
 * finance can state today. It is NOT a substitute for `bank_account_id` and nothing derives one
 * from the other — a payment carrying only this keeps appearing in the unattributed-payments
 * report, because it is still not attributed to a configured account.
 *
 * Nullable, with no backfill: every existing payment reads as null, which is exactly what "nobody
 * was asked" looks like. Nobody can now say which account paid a transfer recorded in July.
 */
const TRANSFER_SOURCES = ['PRIMARY', 'RESERVE'];

export class Migration20260906000000 extends Migration {
  override async up(): Promise<void> {
    // The rate the money actually converted at, stated with the slip. Same shape as
    // `payment.actual_rate` so the payment can adopt it without reformatting a decimal.
    this.addSql(`alter table "payment_attachment" add column "actual_rate" numeric(18,8) null;`);

    const values = TRANSFER_SOURCES.map((t) => `'${t}'`).join(', ');
    for (const table of ['payment', 'payment_attachment']) {
      this.addSql(`alter table "${table}" add column "transfer_from" varchar(255) null;`);
      this.addSql(`alter table "${table}" drop constraint if exists "${table}_transfer_from_check";`);
      this.addSql(
        `alter table "${table}" add constraint "${table}_transfer_from_check" ` +
          `check ("transfer_from" is null or "transfer_from" in (${values}));`,
      );
    }
  }

  override async down(): Promise<void> {
    for (const table of ['payment', 'payment_attachment']) {
      this.addSql(`alter table "${table}" drop constraint if exists "${table}_transfer_from_check";`);
      this.addSql(`alter table "${table}" drop column if exists "transfer_from";`);
    }
    this.addSql(`alter table "payment_attachment" drop column if exists "actual_rate";`);
  }
}
