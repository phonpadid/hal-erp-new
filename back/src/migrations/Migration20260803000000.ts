import { Migration } from '@mikro-orm/migrations';

/**
 * Making attendance final.
 *
 * Five slices made attendance observable and every part of it deliberately mutable. That is right
 * until the moment money is paid against a number, after which a retroactive correction silently
 * changes what somebody was already paid for. Two earlier slices left the seam for this on purpose:
 * `attendance_day.computed_at` is documented as "where a future period close can anchor without
 * migrating old data", and `company.correction_window_days` says outright that "its real purpose
 * arrives with period close".
 *
 * The range is explicit dates, not a year and a month. A Thai payroll cut-off is commonly the 26th
 * to the 25th, which cannot be derived from a month — and `quota_entitlement` already paid for that
 * lesson when a year-keyed period made a WEEKLY reset cycle structurally impossible.
 *
 * `attendance_period_log` is append-only and joins the guard. `attendance_period_line` and its
 * leave children are NOT: a re-close after a reopen has to overwrite them, exactly as recomputation
 * overwrites `attendance_day`.
 *
 * Purely additive and inert until a company declares a period: every gate this slice adds asks
 * "is this date inside a CLOSED period?", and with no periods declared the answer is always no.
 */
export class Migration20260803000000 extends Migration {
  override async up(): Promise<void> {
    // Whether attendance drives pay: a department default with a per-person override, the shape
    // `default_work_shift_id` already established. Nullable on the employee is what makes "inherit"
    // expressible — a non-null default could not tell "deliberately true" from "never set".
    this.addSql(
      `alter table "department" add column "attendance_affects_pay" boolean not null default true;`,
    );
    this.addSql(`alter table "employee" add column "attendance_affects_pay" boolean null;`);

    this.addSql(`create table "attendance_period" (
      "id" uuid not null,
      "company_id" uuid not null,
      "code" varchar(255) not null,
      "period_start" date not null,
      "period_end" date not null,
      "status" text check ("status" in ('DRAFT', 'CLOSED')) not null default 'DRAFT',
      constraint "attendance_period_pkey" primary key ("id")
    );`);
    this.addSql(
      `alter table "attendance_period" add constraint "attendance_period_range_check" check ("period_end" >= "period_start");`,
    );
    this.addSql(
      `alter table "attendance_period" add constraint "attendance_period_company_id_code_unique" unique ("company_id", "code");`,
    );
    this.addSql(
      `create index "attendance_period_company_id_period_start_index" on "attendance_period" ("company_id", "period_start");`,
    );
    this.addSql(
      `alter table "attendance_period" add constraint "attendance_period_company_id_foreign" foreign key ("company_id") references "company" ("id") on update cascade;`,
    );

    this.addSql(`create table "attendance_period_line" (
      "id" uuid not null,
      "company_id" uuid not null,
      "period_id" uuid not null,
      "employee_id" uuid not null,
      "employment_type" varchar(255) not null,
      "attendance_affects_pay" boolean not null,
      "expected_minutes" int not null default 0,
      "worked_minutes" int not null default 0,
      "days_present" smallint not null default 0,
      "days_absent" smallint not null default 0,
      "days_leave" smallint not null default 0,
      "days_not_worked" smallint not null default 0,
      "late_minutes" int not null default 0,
      "late_occurrences" smallint not null default 0,
      "early_leave_minutes" int not null default 0,
      "ot_normal_minutes" int not null default 0,
      "holiday_work_minutes" int not null default 0,
      "ot_holiday_minutes" int not null default 0,
      "uncertified_ot_minutes" int not null default 0,
      constraint "attendance_period_line_pkey" primary key ("id")
    );`);
    this.addSql(
      `alter table "attendance_period_line" add constraint "attendance_period_line_period_id_employee_id_unique" unique ("period_id", "employee_id");`,
    );
    this.addSql(
      `create index "attendance_period_line_company_id_employee_id_index" on "attendance_period_line" ("company_id", "employee_id");`,
    );
    this.addSql(
      `alter table "attendance_period_line" add constraint "attendance_period_line_company_id_foreign" foreign key ("company_id") references "company" ("id") on update cascade;`,
    );
    // Cascade from the period: deleting a DRAFT period that was never closed should not leave
    // orphaned lines, and a closed period is not deletable by any path this slice provides.
    this.addSql(
      `alter table "attendance_period_line" add constraint "attendance_period_line_period_id_foreign" foreign key ("period_id") references "attendance_period" ("id") on update cascade on delete cascade;`,
    );
    this.addSql(
      `alter table "attendance_period_line" add constraint "attendance_period_line_employee_id_foreign" foreign key ("employee_id") references "employee" ("id") on update cascade;`,
    );
    this.addSql(`alter table "attendance_period_line" add constraint "attendance_period_line_minutes_check" check (
      "expected_minutes" >= 0 and "worked_minutes" >= 0 and "late_minutes" >= 0
      and "early_leave_minutes" >= 0 and "ot_normal_minutes" >= 0 and "holiday_work_minutes" >= 0
      and "ot_holiday_minutes" >= 0 and "uncertified_ot_minutes" >= 0
    );`);
    this.addSql(`alter table "attendance_period_line" add constraint "attendance_period_line_days_check" check (
      "days_present" >= 0 and "days_absent" >= 0 and "days_leave" >= 0 and "days_not_worked" >= 0
      and "late_occurrences" >= 0
    );`);

    this.addSql(`create table "attendance_period_leave" (
      "id" uuid not null,
      "line_id" uuid not null,
      "quota_id" uuid not null,
      "days" numeric(15,2) not null,
      constraint "attendance_period_leave_pkey" primary key ("id")
    );`);
    this.addSql(
      `alter table "attendance_period_leave" add constraint "attendance_period_leave_line_id_quota_id_unique" unique ("line_id", "quota_id");`,
    );
    this.addSql(
      `alter table "attendance_period_leave" add constraint "attendance_period_leave_line_id_foreign" foreign key ("line_id") references "attendance_period_line" ("id") on update cascade on delete cascade;`,
    );
    this.addSql(
      `alter table "attendance_period_leave" add constraint "attendance_period_leave_quota_id_foreign" foreign key ("quota_id") references "quota" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "attendance_period_leave" add constraint "attendance_period_leave_days_positive_check" check ("days" > 0);`,
    );

    this.addSql(`create table "attendance_period_log" (
      "id" uuid not null,
      "period_id" uuid not null,
      "action" text check ("action" in ('CLOSE', 'REOPEN')) not null,
      "acted_by" uuid not null,
      "acted_at" timestamptz not null,
      "reason" text null,
      constraint "attendance_period_log_pkey" primary key ("id")
    );`);
    this.addSql(
      `create index "attendance_period_log_period_id_acted_at_index" on "attendance_period_log" ("period_id", "acted_at");`,
    );
    this.addSql(
      `alter table "attendance_period_log" add constraint "attendance_period_log_period_id_foreign" foreign key ("period_id") references "attendance_period" ("id") on update cascade on delete cascade;`,
    );
    // No `on delete` rule: the actor of a close is part of the audit, and deleting a user must not
    // quietly blank it — the same stance the correction slice took for `recorded_by`.
    this.addSql(
      `alter table "attendance_period_log" add constraint "attendance_period_log_acted_by_foreign" foreign key ("acted_by") references "app_user" ("id") on update cascade;`,
    );
    // Reopening a period that may already have been paid should cost a sentence.
    this.addSql(`alter table "attendance_period_log" add constraint "attendance_period_log_reopen_has_reason_check" check (
      "action" <> 'REOPEN' or ("reason" is not null and length(btrim("reason")) > 0)
    );`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "attendance_period_log" cascade;`);
    this.addSql(`drop table if exists "attendance_period_leave" cascade;`);
    this.addSql(`drop table if exists "attendance_period_line" cascade;`);
    this.addSql(`drop table if exists "attendance_period" cascade;`);
    this.addSql(`alter table "employee" drop column if exists "attendance_affects_pay";`);
    this.addSql(`alter table "department" drop column if exists "attendance_affects_pay";`);
  }
}
