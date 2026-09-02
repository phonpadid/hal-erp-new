import { Migration } from '@mikro-orm/migrations';

/**
 * Certifying overtime: turning a recorded observation into a claim.
 *
 * `attendance_day` has counted overtime since the daily slice, split into the three kinds Thai law
 * pays differently, and its spec is explicit that those minutes are RAW — somebody stayed late and
 * nobody agreed to pay for it. `overtime_claim` is the agreement.
 *
 * Its hours are summed from `attendance_day`, never stated by the claimant: the document type
 * carries `derives_quantity`, so generic submit refuses it and the owning endpoint does the
 * summing. The same seam leave established, reused rather than reinvented.
 *
 * NOTHING about claiming is written onto `attendance_day` — no flag, no claim id, no status. That
 * table must stay reproducible from the ledger and configuration alone, and a claim reference is a
 * fact recomputation could not reproduce, so it would be wiped on the next rebuild. "Is this day
 * claimed?" is a join against this table, evaluated when asked. That is why this migration adds no
 * column to `attendance_day`.
 *
 * `company.overtime_weekly_limit_minutes` carries the statutory weekly ceiling (2160 = the 36
 * hours Thai law allows). Deliberately not a quota: `quota_entitlement` is keyed
 * `(quota, employee, year)` and has nowhere to put 52 weekly entitlements — and the shape is wrong
 * regardless. The cap is identical for everyone, never carried forward, granted to nobody, and no
 * employee asks how much of it is left. It limits what an employer may ask for, which is a
 * validation rule over hours already recorded.
 *
 * Purely additive; the ceiling defaults to the Thai figure so no company is left without one.
 */
export class Migration20260801000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "company" add column "overtime_weekly_limit_minutes" int not null default 2160;`,
    );
    this.addSql(
      `alter table "company" add constraint "company_overtime_weekly_limit_check" check ("overtime_weekly_limit_minutes" > 0);`,
    );

    this.addSql(`create table "overtime_claim" (
      "id" uuid not null,
      "company_id" uuid not null,
      "document_id" uuid not null,
      "employee_id" uuid not null,
      "from_date" date not null,
      "to_date" date not null,
      "ot_normal_minutes" int not null default 0,
      "holiday_work_minutes" int not null default 0,
      "ot_holiday_minutes" int not null default 0,
      constraint "overtime_claim_pkey" primary key ("id")
    );`);
    // One certification per document: the document IS the claim.
    this.addSql(
      `alter table "overtime_claim" add constraint "overtime_claim_document_id_unique" unique ("document_id");`,
    );
    // The overlap guard's query: this employee's claims, ordered by where they start.
    this.addSql(
      `create index "overtime_claim_company_id_employee_id_from_date_index" on "overtime_claim" ("company_id", "employee_id", "from_date");`,
    );
    this.addSql(
      `alter table "overtime_claim" add constraint "overtime_claim_company_id_foreign" foreign key ("company_id") references "company" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "overtime_claim" add constraint "overtime_claim_document_id_foreign" foreign key ("document_id") references "document" ("id") on update cascade on delete cascade;`,
    );
    this.addSql(
      `alter table "overtime_claim" add constraint "overtime_claim_employee_id_foreign" foreign key ("employee_id") references "employee" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "overtime_claim" add constraint "overtime_claim_range_check" check ("to_date" >= "from_date");`,
    );
    // Minute counts are durations, and a claim that certifies nothing is not a claim — the service
    // rejects an all-zero range, and the row refuses it too.
    this.addSql(`alter table "overtime_claim" add constraint "overtime_claim_minutes_check" check (
      "ot_normal_minutes" >= 0 and "holiday_work_minutes" >= 0 and "ot_holiday_minutes" >= 0
      and ("ot_normal_minutes" + "holiday_work_minutes" + "ot_holiday_minutes") > 0
    );`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "overtime_claim" cascade;`);
    this.addSql(`alter table "company" drop constraint if exists "company_overtime_weekly_limit_check";`);
    this.addSql(`alter table "company" drop column if exists "overtime_weekly_limit_minutes";`);
  }
}
