import { Migration } from '@mikro-orm/migrations';

/**
 * The route a document runs becomes a record instead of a re-derivation.
 *
 * Everything in this codebase that someone could later dispute is snapshotted, and each one says
 * why: the FX rate is stamped at submit, the approver's signature at approval, the payee details on
 * the batch line, the exact bytes sent to the bank. The approval route was the exception — a
 * document remembered one integer, `current_step_no`, and every other fact about its chain was read
 * live from `workflow_step` on each advance.
 *
 * That cost five things: a step could not be timed from when it opened (so a slow first approver
 * left every later step instantly overdue), an issued PDF changed when the workflow was edited,
 * configuration had to be frozen while any document was in flight, a PARALLEL_ALL step's required
 * approvals moved with role membership, and a step inserted mid-flight was silently skipped or
 * silently required.
 *
 * `document_approval_step_actor` holds the principals a step is waiting for, recorded when the step
 * OPENS rather than at submit: a role change between submit and a later step opening should reach
 * that step; what must not move is the set while the step is being approved.
 *
 * No backfill. Nothing has launched, so no document is routing on a live workflow, and a backfill
 * would be code that runs against no rows and is never tested against real ones.
 */
export class Migration20260828000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "document_approval_step" (
      "id" uuid not null default gen_random_uuid(),
      "document_id" uuid not null,
      "step_no" int not null,
      "step_name" varchar(255) null,
      "approver_role_id" uuid null,
      "approver_user_id" uuid null,
      "approve_mode" varchar(255) not null default 'SEQUENTIAL',
      "sla_hours" int null,
      "show_signature_on_pdf" boolean not null default true,
      "status" varchar(255) not null default 'PENDING',
      "started_at" timestamptz null,
      "completed_at" timestamptz null,
      "superseded_at" timestamptz null,
      "source_workflow_step_id" uuid null,
      "created_at" timestamptz null,
      constraint "document_approval_step_pkey" primary key ("id")
    );`);

    // One live row per (document, step). A returned-and-resubmitted document keeps its first route,
    // so the constraint has to exempt the superseded ones.
    this.addSql(
      `create unique index "document_approval_step_live_uniq" on "document_approval_step" ` +
        `("document_id", "step_no") where "superseded_at" is null;`,
    );
    this.addSql(
      `create index "document_approval_step_document_id_index" on "document_approval_step" ("document_id");`,
    );

    this.addSql(
      `alter table "document_approval_step" add constraint "document_approval_step_document_id_foreign" ` +
        `foreign key ("document_id") references "document" ("id") on update cascade on delete cascade;`,
    );
    this.addSql(
      `alter table "document_approval_step" add constraint "document_approval_step_approver_role_id_foreign" ` +
        `foreign key ("approver_role_id") references "role" ("id") on update cascade on delete set null;`,
    );
    this.addSql(
      `alter table "document_approval_step" add constraint "document_approval_step_approver_user_id_foreign" ` +
        `foreign key ("approver_user_id") references "app_user" ("id") on update cascade on delete set null;`,
    );
    // SET NULL, not RESTRICT: a configured step may be deleted, and the route row carries its own
    // copy of everything routing needs — the same reason `approval_log.step_no` is a value.
    this.addSql(
      `alter table "document_approval_step" add constraint "document_approval_step_source_workflow_step_id_foreign" ` +
        `foreign key ("source_workflow_step_id") references "workflow_step" ("id") on update cascade on delete set null;`,
    );

    this.addSql(`create table "document_approval_step_actor" (
      "id" uuid not null default gen_random_uuid(),
      "step_id" uuid not null,
      "user_id" uuid not null,
      constraint "document_approval_step_actor_pkey" primary key ("id")
    );`);
    this.addSql(
      `alter table "document_approval_step_actor" add constraint "document_approval_step_actor_uniq" ` +
        `unique ("step_id", "user_id");`,
    );
    this.addSql(
      `alter table "document_approval_step_actor" add constraint "document_approval_step_actor_step_id_foreign" ` +
        `foreign key ("step_id") references "document_approval_step" ("id") on update cascade on delete cascade;`,
    );
    this.addSql(
      `alter table "document_approval_step_actor" add constraint "document_approval_step_actor_user_id_foreign" ` +
        `foreign key ("user_id") references "app_user" ("id") on update cascade;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "document_approval_step_actor" cascade;`);
    this.addSql(`drop table if exists "document_approval_step" cascade;`);
  }
}
