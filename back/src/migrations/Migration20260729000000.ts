import { Migration } from '@mikro-orm/migrations';

/**
 * The daily attendance projection: expectation joined to observation.
 *
 * `attendance_day` is to `attendance_event` what `stock_balance` is to `stock_txn` — the ledger is
 * the truth, this row exists so nobody aggregates the ledger on every read, and replaying the
 * ledger must reproduce it exactly (invariant 3). It is therefore NOT append-only and is
 * deliberately absent from `LedgerGuardSubscriber`: recomputation overwrites it, and the fact that
 * it can be dropped and rebuilt is why the ledger beneath it never can.
 *
 * `shift_date` is the day of the SHIFT, not of the punch. A 22:00-06:00 night shift for the 1st
 * consumes punches from the 1st and the morning of the 2nd; grouping by the punch's own
 * `local_date` would split it into two half-days and mark both incomplete.
 *
 * The four `expected_*` columns are a snapshot of the shift as it stood at computation, judged
 * against rather than re-read. The holiday calendar is NOT snapshotted. The asymmetry is the point:
 * editing shift hours is a decision about the future and must not rewrite past verdicts, whereas a
 * retroactively declared public holiday corrects a misstatement about the past and should.
 *
 * Overtime is three columns because Thai law prices the kinds differently and a total cannot be
 * unsplit afterwards. No multiplier is stored anywhere — hours by kind are exported and priced by
 * whatever consumes them, since this platform spans jurisdictions with different rates.
 *
 * No backfill: the table is derived and is populated by running recomputation. `down` is a plain
 * drop, which is safe precisely because nothing here is a source of truth.
 */
export class Migration20260729000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "attendance_day" (
      "id" uuid not null,
      "company_id" uuid not null,
      "employee_id" uuid not null,
      "shift_date" date not null,
      "shift_code" varchar(255) null,
      "expected_in_minute" smallint null,
      "expected_out_minute" smallint null,
      "expected_minutes" smallint null,
      "first_in_at" timestamptz null,
      "last_out_at" timestamptz null,
      "punch_count" int not null default 0,
      "worked_minutes" int not null default 0,
      "late_minutes" int not null default 0,
      "late_occurrences" smallint not null default 0,
      "early_leave_minutes" int not null default 0,
      "ot_normal_minutes" int not null default 0,
      "holiday_work_minutes" int not null default 0,
      "ot_holiday_minutes" int not null default 0,
      "status" text check ("status" in ('PRESENT', 'ABSENT', 'INCOMPLETE', 'HOLIDAY', 'DAY_OFF', 'EXEMPT', 'NO_SHIFT')) not null,
      "computed_at" timestamptz not null,
      constraint "attendance_day_pkey" primary key ("id")
    );`);

    // One row per person per shift day — this is what makes the projection a projection, and it is
    // what a concurrent recompute would otherwise violate.
    this.addSql(
      `alter table "attendance_day" add constraint "attendance_day_company_id_employee_id_shift_date_unique" unique ("company_id", "employee_id", "shift_date");`,
    );
    // The supervisor board: everyone on one date.
    this.addSql(
      `create index "attendance_day_company_id_shift_date_index" on "attendance_day" ("company_id", "shift_date");`,
    );

    this.addSql(
      `alter table "attendance_day" add constraint "attendance_day_company_id_foreign" foreign key ("company_id") references "company" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "attendance_day" add constraint "attendance_day_employee_id_foreign" foreign key ("employee_id") references "employee" ("id") on update cascade;`,
    );

    // Minute columns are counts of elapsed time and can never be negative. Cheap to assert, and it
    // turns an arithmetic slip in the computation into a loud failure rather than a quiet wrong
    // number on somebody's attendance record.
    this.addSql(`alter table "attendance_day" add constraint "attendance_day_minutes_non_negative_check" check (
      "worked_minutes" >= 0 and "late_minutes" >= 0 and "late_occurrences" >= 0
      and "early_leave_minutes" >= 0 and "ot_normal_minutes" >= 0
      and "holiday_work_minutes" >= 0 and "ot_holiday_minutes" >= 0 and "punch_count" >= 0
    );`);
    // Occurrences are per day, so the only sensible values are 0 and 1; a sum over a month is then
    // literally the number of late days.
    this.addSql(
      `alter table "attendance_day" add constraint "attendance_day_late_occurrences_check" check ("late_occurrences" in (0, 1));`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "attendance_day" cascade;`);
  }
}
