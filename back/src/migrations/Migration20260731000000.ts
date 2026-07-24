import { Migration } from '@mikro-orm/migrations';

/**
 * Who enforces a capability's own rules.
 *
 * Three leave rules must fire BEFORE a quota reservation is written: the charged quantity must
 * equal the counted working days, the notice window must hold, and a long sick leave must carry
 * its certificate. All three belong to leave, and none can live in `DocumentSubmitService` —
 * document-engine is built before attendance and cannot import it.
 *
 * `document_type.derives_quantity` resolves that without a dependency. Generic submit reads the
 * flag from its OWN table and declines, pointing the caller at the capability that owns the type;
 * that capability computes the quantity and delegates back. Configuration, not code, crosses the
 * boundary — the same shape as every other `requires_*` flag already on the table.
 *
 * `leave_type` holds the per-kind rules, one-to-one with the quota representing that kind. Not
 * columns on `quota`, because `quota` is a general allowance also used for overtime hours and
 * asset bookings, and a booking quota has no business carrying a medical-certificate threshold —
 * exactly the coupling refused above, in the other direction.
 *
 * Timing is two integers rather than a boolean plus a limit: "backdating allowed, limit unset"
 * would mean nothing in particular, while 0 says precisely one thing.
 *
 * Purely additive; both defaults reproduce today's behaviour (no type derives its quantity, and a
 * quota with no `leave_type` row is not a leave type at all).
 */
export class Migration20260731000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "document_type" add column "derives_quantity" boolean not null default false;`,
    );

    this.addSql(`create table "leave_type" (
      "id" uuid not null,
      "quota_id" uuid not null,
      "advance_notice_days" int not null default 0,
      "backdate_limit_days" int not null default 0,
      "attachment_required_over_days" int null,
      "is_active" boolean not null default true,
      constraint "leave_type_pkey" primary key ("id")
    );`);
    // One configuration per leave kind: the quota IS the kind.
    this.addSql(
      `alter table "leave_type" add constraint "leave_type_quota_id_unique" unique ("quota_id");`,
    );
    this.addSql(
      `alter table "leave_type" add constraint "leave_type_quota_id_foreign" foreign key ("quota_id") references "quota" ("id") on update cascade;`,
    );
    // Day counts are durations; a negative notice or backdate window has no meaning.
    this.addSql(`alter table "leave_type" add constraint "leave_type_day_counts_check" check (
      "advance_notice_days" >= 0 and "backdate_limit_days" >= 0
      and ("attachment_required_over_days" is null or "attachment_required_over_days" >= 0)
    );`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "leave_type" cascade;`);
    this.addSql(`alter table "document_type" drop column if exists "derives_quantity";`);
  }
}
