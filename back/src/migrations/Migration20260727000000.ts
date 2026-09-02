import { Migration } from '@mikro-orm/migrations';

/**
 * Attendance foundation: what the company EXPECTS of an employee. No time records here — this
 * migration adds only the shift definitions a later `attendance_day` will judge against, plus
 * the timezone that says when a day starts.
 *
 * - `work_shift` — per-company hours master (invariant 1). Times are minutes from local
 *   midnight, not `time` columns: a 22:00-06:00 night shift is start 1320 / end 1800, so
 *   duration is `end - start` with no branch and "crosses midnight" is derived from
 *   `end_minute > 1440` rather than stored. A stored flag can contradict the times it
 *   describes; a derived one cannot.
 * - `work_shift_day` — which weekdays the shift works, with optional per-day hours. A table
 *   rather than a bitmask because Saturday half-day (Mon-Fri 08:00-17:00, Sat 08:00-12:00) is
 *   not an on/off state — Saturday has different hours, which no "which days" flag can express.
 * - `employee_shift` — dated, fixed assignment of a person to a shift. Ranges for one employee
 *   must not overlap; the check runs in the service inside the write transaction (a PostgreSQL
 *   EXCLUDE constraint over a daterange would need the btree_gist extension).
 * - `work_location` — geofence definitions. `control_policy` reuses the budget over-limit enum
 *   because the shape is identical: a configured limit, a value outside it, and a per-row choice
 *   between blocking and recording. Nothing enforces it yet; the capture slice does.
 * - `company.timezone` — every date calculation in this system currently runs in UTC. For an
 *   approval SLA that is a rounding error; for attendance it is a wrong "absent" on a real
 *   person's record. Backfilled to Asia/Bangkok, which is correct for every company in the data
 *   today, then set NOT NULL so no code path handles an absent zone.
 * - `employee.attendance_required` / `employment_type` — who is expected to clock in, and the
 *   pay basis that makes holiday work compensate differently for monthly- vs daily-paid staff.
 *
 * Every column is additive with a default and every table is new, so nothing existing reads them
 * and a partial deploy is inert rather than broken. `down` drops cleanly with no data to
 * reinterpret.
 */
export class Migration20260727000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "work_shift" (
      "id" uuid not null,
      "company_id" uuid not null,
      "code" varchar(255) not null,
      "name" varchar(255) not null,
      "start_minute" smallint not null,
      "end_minute" smallint not null,
      "break_start_minute" smallint null,
      "break_end_minute" smallint null,
      "standard_minutes" smallint not null,
      "grace_minutes" smallint not null default 15,
      "half_day_threshold_minutes" smallint not null,
      "ot_min_minutes" smallint not null default 30,
      "ot_round_minutes" smallint not null default 30,
      "is_active" boolean not null default true,
      constraint "work_shift_pkey" primary key ("id")
    );`);
    // Per company, not globally: two companies may each run a shift called OFFICE.
    this.addSql(
      `alter table "work_shift" add constraint "work_shift_company_id_code_unique" unique ("company_id", "code");`,
    );
    this.addSql(`create index "work_shift_company_id_index" on "work_shift" ("company_id");`);
    this.addSql(
      `alter table "work_shift" add constraint "work_shift_company_id_foreign" foreign key ("company_id") references "company" ("id") on update cascade;`,
    );
    // A shift that ends before it starts has no duration to compute; reject it at the storage
    // layer too, not only in the service.
    this.addSql(
      `alter table "work_shift" add constraint "work_shift_end_after_start_check" check ("end_minute" > "start_minute");`,
    );

    this.addSql(`create table "work_shift_day" (
      "id" uuid not null,
      "work_shift_id" uuid not null,
      "weekday" smallint not null,
      "is_working" boolean not null default true,
      "start_minute" smallint null,
      "end_minute" smallint null,
      constraint "work_shift_day_pkey" primary key ("id")
    );`);
    this.addSql(
      `alter table "work_shift_day" add constraint "work_shift_day_work_shift_id_weekday_unique" unique ("work_shift_id", "weekday");`,
    );
    this.addSql(
      `alter table "work_shift_day" add constraint "work_shift_day_work_shift_id_foreign" foreign key ("work_shift_id") references "work_shift" ("id") on update cascade on delete cascade;`,
    );
    // ISO weekday numbering: 1 = Monday ... 7 = Sunday.
    this.addSql(
      `alter table "work_shift_day" add constraint "work_shift_day_weekday_check" check ("weekday" between 1 and 7);`,
    );

    this.addSql(`create table "employee_shift" (
      "id" uuid not null,
      "company_id" uuid not null,
      "employee_id" uuid not null,
      "work_shift_id" uuid not null,
      "effective_from" date not null,
      "effective_to" date null,
      constraint "employee_shift_pkey" primary key ("id")
    );`);
    // Not full overlap prevention (that needs btree_gist) but it does stop the exact-duplicate
    // start date, which is the common double-submit.
    this.addSql(
      `alter table "employee_shift" add constraint "employee_shift_employee_id_effective_from_unique" unique ("employee_id", "effective_from");`,
    );
    this.addSql(
      `create index "employee_shift_company_id_employee_id_effective_from_index" on "employee_shift" ("company_id", "employee_id", "effective_from");`,
    );
    this.addSql(
      `alter table "employee_shift" add constraint "employee_shift_company_id_foreign" foreign key ("company_id") references "company" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "employee_shift" add constraint "employee_shift_employee_id_foreign" foreign key ("employee_id") references "employee" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "employee_shift" add constraint "employee_shift_work_shift_id_foreign" foreign key ("work_shift_id") references "work_shift" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "employee_shift" add constraint "employee_shift_effective_range_check" check ("effective_to" is null or "effective_to" >= "effective_from");`,
    );

    this.addSql(`create table "work_location" (
      "id" uuid not null,
      "company_id" uuid not null,
      "code" varchar(255) not null,
      "name" varchar(255) not null,
      "latitude" numeric(9,6) not null,
      "longitude" numeric(9,6) not null,
      "radius_meters" int not null,
      "control_policy" text check ("control_policy" in ('HARD_STOP', 'SOFT_WARNING')) not null default 'SOFT_WARNING',
      "is_active" boolean not null default true,
      constraint "work_location_pkey" primary key ("id")
    );`);
    this.addSql(
      `alter table "work_location" add constraint "work_location_company_id_code_unique" unique ("company_id", "code");`,
    );
    this.addSql(`create index "work_location_company_id_index" on "work_location" ("company_id");`);
    this.addSql(
      `alter table "work_location" add constraint "work_location_company_id_foreign" foreign key ("company_id") references "company" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "work_location" add constraint "work_location_coordinates_check" check ("latitude" between -90 and 90 and "longitude" between -180 and 180 and "radius_meters" > 0);`,
    );

    // Add nullable, backfill, then constrain — no existing row is left without a zone, and no
    // deploy window exists in which a company has a null one.
    this.addSql(`alter table "company" add column "timezone" varchar(255) null;`);
    this.addSql(`update "company" set "timezone" = 'Asia/Bangkok' where "timezone" is null;`);
    this.addSql(`alter table "company" alter column "timezone" set default 'Asia/Bangkok';`);
    this.addSql(`alter table "company" alter column "timezone" set not null;`);

    this.addSql(`alter table "department" add column "default_work_shift_id" uuid null;`);
    this.addSql(
      `alter table "department" add constraint "department_default_work_shift_id_foreign" foreign key ("default_work_shift_id") references "work_shift" ("id") on update cascade on delete set null;`,
    );

    this.addSql(
      `alter table "employee" add column "attendance_required" boolean not null default true;`,
    );
    this.addSql(
      `alter table "employee" add column "employment_type" text check ("employment_type" in ('MONTHLY', 'DAILY', 'HOURLY')) not null default 'MONTHLY';`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "employee" drop column if exists "employment_type";`);
    this.addSql(`alter table "employee" drop column if exists "attendance_required";`);
    this.addSql(
      `alter table "department" drop constraint if exists "department_default_work_shift_id_foreign";`,
    );
    this.addSql(`alter table "department" drop column if exists "default_work_shift_id";`);
    this.addSql(`alter table "company" drop column if exists "timezone";`);
    this.addSql(`drop table if exists "work_location" cascade;`);
    this.addSql(`drop table if exists "employee_shift" cascade;`);
    this.addSql(`drop table if exists "work_shift_day" cascade;`);
    this.addSql(`drop table if exists "work_shift" cascade;`);
  }
}
