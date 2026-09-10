import { Migration } from '@mikro-orm/migrations';

/**
 * `payment.recovery_status` / `recovery_flagged_at` / `recovery_resolved_reference` — set only
 * when a payment was recorded early (while its document was still `IN_APPROVAL`, at a step
 * requiring evidence) and that document was later rejected. Recording early never writes a
 * `budget_txn`, so the rejection still releases the reservation in full; these columns exist
 * because a `payment` row proving real money already left the company would otherwise sit next to
 * a reservation the ledger shows as untouched, with nothing pointing accounting at it.
 *
 * All three nullable, no default: every existing `payment` row is untouched and reads as "not
 * applicable" — this case could not occur before mid-approval recording existed.
 */
export class Migration20260909000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "payment" add column "recovery_status" varchar(255) null, add column "recovery_flagged_at" timestamptz null, add column "recovery_resolved_reference" text null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "payment" drop column "recovery_status", drop column "recovery_flagged_at", drop column "recovery_resolved_reference";`,
    );
  }
}
