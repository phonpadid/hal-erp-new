import { Migration } from '@mikro-orm/migrations';

/**
 * Attendance capture: the punch itself.
 *
 * `attendance_event` is the fourth append-only ledger in this schema, after `budget_txn` /
 * `approval_log`, the GL journal, and `stock_txn`. It is guarded by the same
 * `LedgerGuardSubscriber`, and a wrong punch is superseded by a new row naming it in
 * `corrects_event_id` rather than edited — an observation that can be rewritten after the fact
 * is worth nothing as evidence, which is the entire reason to record attendance at all.
 *
 * Two columns carry the same moment on purpose. `occurred_at` is the instant; `local_date` is the
 * company-local calendar day that instant fell on, computed from `company.timezone` at insert and
 * never derived at read. `company.timezone` is editable master data: deriving the day would mean
 * that correcting a company's zone silently moved every punch near a midnight boundary onto a
 * different day, taking every lateness and absence figure already reported with it. The instant is
 * kept alongside so a bad stamp can be detected and recomputed.
 *
 * Indexes are chosen for the two questions that will actually be asked — "every punch for this
 * employee on this local date" (the daily projection, constantly) and "everyone today" (the
 * supervisor board). `occurred_at` is deliberately not indexed: nothing queries in instant-space.
 * This is the first table here that grows with headcount x days rather than with documents.
 *
 * Purely additive: the table is new and starts empty, nothing existing reads it, and `down` is a
 * plain drop with no data to reinterpret.
 */
export class Migration20260728000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "attendance_event" (
      "id" uuid not null,
      "company_id" uuid not null,
      "employee_id" uuid not null,
      "occurred_at" timestamptz not null,
      "local_date" date not null,
      "direction" text check ("direction" in ('IN', 'OUT')) not null,
      "source" text check ("source" in ('WEB', 'MOBILE', 'DEVICE', 'IMPORT', 'MANUAL')) not null,
      "work_location_id" uuid null,
      "latitude" numeric(9,6) null,
      "longitude" numeric(9,6) null,
      "distance_meters" int null,
      "geofence_status" text check ("geofence_status" in ('INSIDE', 'OUTSIDE', 'UNKNOWN')) not null default 'UNKNOWN',
      "device_id" varchar(255) null,
      "remark" text null,
      "recorded_by" uuid null,
      "corrects_event_id" uuid null,
      "created_at" timestamptz not null,
      constraint "attendance_event_pkey" primary key ("id")
    );`);

    // The daily projection's constant question.
    this.addSql(
      `create index "attendance_event_company_id_employee_id_local_date_index" on "attendance_event" ("company_id", "employee_id", "local_date");`,
    );
    // The supervisor board's question.
    this.addSql(
      `create index "attendance_event_company_id_local_date_index" on "attendance_event" ("company_id", "local_date");`,
    );

    this.addSql(
      `alter table "attendance_event" add constraint "attendance_event_company_id_foreign" foreign key ("company_id") references "company" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "attendance_event" add constraint "attendance_event_employee_id_foreign" foreign key ("employee_id") references "employee" ("id") on update cascade;`,
    );
    // No `on delete set null` on any of the three nullable references below. The obvious default
    // is actively wrong here: the two check constraints further down tie `work_location_id` to
    // `distance_meters` and `recorded_by` to `source = 'MANUAL'`, so blanking either on a delete
    // would produce a row that violates its own table. Deleting the referenced row is refused
    // instead — which is the right answer anyway for evidence that must stay auditable.
    this.addSql(
      `alter table "attendance_event" add constraint "attendance_event_work_location_id_foreign" foreign key ("work_location_id") references "work_location" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "attendance_event" add constraint "attendance_event_recorded_by_foreign" foreign key ("recorded_by") references "app_user" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "attendance_event" add constraint "attendance_event_corrects_event_id_foreign" foreign key ("corrects_event_id") references "attendance_event" ("id") on update cascade;`,
    );
    // MANUAL is the only source produced by a human acting for someone else, and it is the only
    // one that may name an actor. Enforced here as well as in the service: the audit story for a
    // hand-entered punch rests entirely on recorded_by being both present and truthful.
    this.addSql(
      `alter table "attendance_event" add constraint "attendance_event_manual_has_actor_check" check (("source" = 'MANUAL') = ("recorded_by" is not null));`,
    );
    // A punch is either measured against a location or it is not; a distance with no location, or
    // a location with no distance, would be a half-recorded measurement.
    this.addSql(
      `alter table "attendance_event" add constraint "attendance_event_geofence_measured_check" check (("work_location_id" is null) = ("distance_meters" is null));`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "attendance_event" cascade;`);
  }
}
