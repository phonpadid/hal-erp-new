import { Migration } from '@mikro-orm/migrations';

/**
 * A deadline stops being an approver.
 *
 * `escalateOverdue` used to move `current_step_no` past the overdue step. The approval the amount
 * band and the job-level condition said the document required was then performed by nobody: not
 * rejected, not approved, not reassigned — just gone. A requester who would rather not be seen by
 * their department head could submit, wait out `sla_hours`, and have that head removed from the
 * route by the sweep.
 *
 * No standard system does this. A timeout is a question of WHO, never of WHETHER: forward to a
 * deputy, to a superior, to an administrator's queue, or simply keep asking. The number of
 * approvals a document needs is not a function of how fast people read their mail.
 *
 * So a step names where it escalates, and escalation records that target ON the step instead of
 * walking past it. `escalated_at` makes the act idempotent: a sweep every five minutes chases the
 * approver every five minutes, but writes one row.
 *
 * The schema still models no reporting line, which is why the target is configuration rather than
 * `employee.manager_id` — that is master data with its own maintenance and its own change.
 */
export class Migration20260829000000 extends Migration {
  override async up(): Promise<void> {
    for (const table of ['workflow_step', 'document_approval_step']) {
      this.addSql(`alter table "${table}" add column "escalate_to_role_id" uuid null;`);
      this.addSql(`alter table "${table}" add column "escalate_to_user_id" uuid null;`);
      this.addSql(
        `alter table "${table}" add constraint "${table}_escalate_to_role_id_foreign" ` +
          `foreign key ("escalate_to_role_id") references "role" ("id") on update cascade on delete set null;`,
      );
      this.addSql(
        `alter table "${table}" add constraint "${table}_escalate_to_user_id_foreign" ` +
          `foreign key ("escalate_to_user_id") references "app_user" ("id") on update cascade on delete set null;`,
      );
    }

    // Who the step was actually escalated to, and when — the record of the act, distinct from the
    // configuration of where it would go.
    this.addSql(`alter table "document_approval_step" add column "escalated_to_user_id" uuid null;`);
    this.addSql(`alter table "document_approval_step" add column "escalated_at" timestamptz null;`);
    this.addSql(
      `alter table "document_approval_step" add constraint "document_approval_step_escalated_to_user_id_foreign" ` +
        `foreign key ("escalated_to_user_id") references "app_user" ("id") on update cascade on delete set null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "document_approval_step" drop column "escalated_at";`);
    this.addSql(`alter table "document_approval_step" drop column "escalated_to_user_id";`);
    for (const table of ['document_approval_step', 'workflow_step']) {
      this.addSql(`alter table "${table}" drop column "escalate_to_user_id";`);
      this.addSql(`alter table "${table}" drop column "escalate_to_role_id";`);
    }
  }
}
