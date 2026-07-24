import { Migration } from '@mikro-orm/migrations';

/**
 * Fixing a wrong punch without editing one.
 *
 * `attendance_event.corrects_event_id` has existed since the capture slice, with a comment saying
 * a wrong punch is superseded by a new row naming it. Nothing has ever written it: the row always
 * had somewhere to go, and what was missing was the authority to write it. `time_correction` is
 * that authority, and only full approval exercises it.
 *
 * Note what this migration does NOT add: any column on `attendance_event`, and any column on
 * `attendance_day`. The ledger already had the seam, and the daily projection is derived — the
 * only way to move it is to move the ledger and recompute. A correction therefore names a punch,
 * never a number.
 *
 * A removal is a supersession rather than a delete, because the ledger cannot delete (invariant 2).
 * `REMOVE` produces a corrective row naming its target, and the day's punch collection skips both.
 * That avoids inventing a `VOID` value in `attendance_direction`, which would put a value meaning
 * neither "in" nor "out" into an enum that answers exactly that question.
 *
 * `company.correction_window_days` bounds how far back a correction may reach, measured from the
 * shift day being corrected. Its real purpose arrives with period close; until then it stops
 * arbitrarily old attendance being reopened.
 *
 * Purely additive, and inert on existing data: no event is superseded today, so every existing day
 * computes exactly as it did before the exclusion rule landed.
 */
export class Migration20260802000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "company" add column "correction_window_days" int not null default 30;`,
    );
    this.addSql(
      `alter table "company" add constraint "company_correction_window_check" check ("correction_window_days" >= 0);`,
    );

    this.addSql(`create table "time_correction" (
      "id" uuid not null,
      "company_id" uuid not null,
      "document_id" uuid not null,
      "employee_id" uuid not null,
      "shift_date" date not null,
      "kind" text check ("kind" in ('ADD', 'CHANGE', 'REMOVE')) not null,
      "target_event_id" uuid null,
      "requested_at" timestamptz null,
      "requested_direction" text check ("requested_direction" in ('IN', 'OUT')) null,
      "reason" text not null,
      constraint "time_correction_pkey" primary key ("id")
    );`);
    this.addSql(
      `alter table "time_correction" add constraint "time_correction_document_id_unique" unique ("document_id");`,
    );
    this.addSql(
      `create index "time_correction_company_id_employee_id_shift_date_index" on "time_correction" ("company_id", "employee_id", "shift_date");`,
    );
    this.addSql(
      `alter table "time_correction" add constraint "time_correction_company_id_foreign" foreign key ("company_id") references "company" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "time_correction" add constraint "time_correction_document_id_foreign" foreign key ("document_id") references "document" ("id") on update cascade on delete cascade;`,
    );
    this.addSql(
      `alter table "time_correction" add constraint "time_correction_employee_id_foreign" foreign key ("employee_id") references "employee" ("id") on update cascade;`,
    );
    // No `on delete` rule: a superseded event must never disappear, and the correction that names
    // it is part of why it must not.
    this.addSql(
      `alter table "time_correction" add constraint "time_correction_target_event_id_foreign" foreign key ("target_event_id") references "attendance_event" ("id") on update cascade;`,
    );

    // The kind decides which columns must be present. Enforced here as well as in the service,
    // because a CHANGE with no target is not a request the system can act on at all.
    this.addSql(`alter table "time_correction" add constraint "time_correction_shape_check" check (
      (("kind" = 'ADD') and "target_event_id" is null and "requested_at" is not null and "requested_direction" is not null)
      or (("kind" = 'CHANGE') and "target_event_id" is not null and "requested_at" is not null and "requested_direction" is not null)
      or (("kind" = 'REMOVE') and "target_event_id" is not null and "requested_at" is null and "requested_direction" is null)
    );`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "time_correction" cascade;`);
    this.addSql(`alter table "company" drop constraint if exists "company_correction_window_check";`);
    this.addSql(`alter table "company" drop column if exists "correction_window_days";`);
  }
}
