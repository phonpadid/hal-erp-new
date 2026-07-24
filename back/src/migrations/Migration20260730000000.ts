import { Migration } from '@mikro-orm/migrations';

/**
 * Leave: the `leave_request` record, and the two `quota` columns that make statutory sick leave
 * expressible at all.
 *
 * `quota.control_policy` — Thai law entitles an employee to sick leave for as long as they are
 * genuinely ill, while paying for at most 30 days a year. A quota that blocks at the paid ceiling
 * is not implementing that law, it is contradicting it. The same enum budget uses, for the same
 * shape of problem: a configured limit, a value beyond it, and a per-row choice between refusing
 * and recording. Defaults to HARD_STOP, so every quota that exists today keeps blocking exactly as
 * it does now — the loosening is opt-in, one quota at a time.
 *
 * `quota.paid_limit_value` — how much is COMPENSATED, separate from how much may be TAKEN. These
 * had to be two columns because the paid boundary can fall inside a single request: an employee at
 * 28 of 30 paid sick days who asks for 5 more takes 2 paid and 3 unpaid. A boolean on the quota
 * cannot say that, and a flag on each usage row would put a derived fact into storage where it can
 * drift from the ledger. Null means "paid up to the limit", which is what every existing quota
 * already implies — so there is nothing to backfill.
 *
 * `leave_request` stores a range with half-day ends rather than a number of days, because the
 * daily projection cannot judge a 13:00 arrival without knowing whether the morning was taken.
 * `total_days` counts working days only, resolved against the employee's shift and the company
 * holidays, so a range spanning a public holiday charges less than its length.
 *
 * Purely additive. `down` drops the table and both columns; the worst it can do is return a quota
 * that had been opted into SOFT_WARNING to blocking, which is the pre-slice behaviour by definition.
 */
export class Migration20260730000000 extends Migration {
  override async up(): Promise<void> {
    // The daily projection reserved a slot for LEAVE but could not accept the value: the previous
    // slice's check constraint enumerated the statuses that existed then. Widening it is what
    // actually turns the reserved slot into a usable one.
    this.addSql(`alter table "attendance_day" drop constraint if exists "attendance_day_status_check";`);
    this.addSql(
      `alter table "attendance_day" add constraint "attendance_day_status_check" check ("status" in ('PRESENT', 'ABSENT', 'INCOMPLETE', 'LEAVE', 'HOLIDAY', 'DAY_OFF', 'EXEMPT', 'NO_SHIFT'));`,
    );

    this.addSql(
      `alter table "quota" add column "paid_limit_value" numeric(15,2) null;`,
    );
    this.addSql(
      `alter table "quota" add column "control_policy" text check ("control_policy" in ('HARD_STOP', 'SOFT_WARNING')) not null default 'HARD_STOP';`,
    );
    // A quota cannot pay for more than it allows to be taken.
    this.addSql(
      `alter table "quota" add constraint "quota_paid_limit_within_limit_check" check ("paid_limit_value" is null or "paid_limit_value" <= "limit_value");`,
    );

    this.addSql(`create table "leave_request" (
      "id" uuid not null,
      "document_id" uuid not null,
      "quota_id" uuid not null,
      "employee_id" uuid not null,
      "from_date" date not null,
      "from_half" text check ("from_half" in ('FULL', 'AM', 'PM')) not null default 'FULL',
      "to_date" date not null,
      "to_half" text check ("to_half" in ('FULL', 'AM', 'PM')) not null default 'FULL',
      "total_days" numeric(15,2) not null,
      constraint "leave_request_pkey" primary key ("id")
    );`);
    // One request per document: a leave document IS one request, not a container of several.
    this.addSql(
      `alter table "leave_request" add constraint "leave_request_document_id_unique" unique ("document_id");`,
    );
    // The daily projection's question: who is on leave on this date.
    this.addSql(
      `create index "leave_request_employee_id_from_date_index" on "leave_request" ("employee_id", "from_date");`,
    );
    this.addSql(
      `create index "leave_request_quota_id_from_date_index" on "leave_request" ("quota_id", "from_date");`,
    );
    this.addSql(
      `alter table "leave_request" add constraint "leave_request_employee_id_foreign" foreign key ("employee_id") references "employee" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "leave_request" add constraint "leave_request_document_id_foreign" foreign key ("document_id") references "document" ("id") on update cascade on delete cascade;`,
    );
    this.addSql(
      `alter table "leave_request" add constraint "leave_request_quota_id_foreign" foreign key ("quota_id") references "quota" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "leave_request" add constraint "leave_request_range_check" check ("to_date" >= "from_date");`,
    );
    // A request that charges nothing is not a request; the service rejects it, and so does the row.
    this.addSql(
      `alter table "leave_request" add constraint "leave_request_total_days_positive_check" check ("total_days" > 0);`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "leave_request" cascade;`);
    this.addSql(`alter table "attendance_day" drop constraint if exists "attendance_day_status_check";`);
    this.addSql(
      `alter table "attendance_day" add constraint "attendance_day_status_check" check ("status" in ('PRESENT', 'ABSENT', 'INCOMPLETE', 'HOLIDAY', 'DAY_OFF', 'EXEMPT', 'NO_SHIFT'));`,
    );
    this.addSql(`alter table "quota" drop constraint if exists "quota_paid_limit_within_limit_check";`);
    this.addSql(`alter table "quota" drop column if exists "control_policy";`);
    this.addSql(`alter table "quota" drop column if exists "paid_limit_value";`);
  }
}
