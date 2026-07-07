import { Migration } from '@mikro-orm/migrations';

/**
 * Approval-workflow completion:
 * - workflow_step.condition_json — per-step engagement condition by requester position
 *   level, e.g. {"jobLevels":["MANAGER"]} (null = applies to everyone).
 * - approve_action gains ESCALATE so an SLA auto-forward is an auditable, append-only
 *   approval_log row distinct from a manual DELEGATE. The action column is a text check
 *   constraint, so the constraint is widened to include ESCALATE.
 */
export class Migration20260629000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "workflow_step" add column "condition_json" text null;`);

    this.addSql(`alter table "approval_log" drop constraint if exists "approval_log_action_check";`);
    this.addSql(
      `alter table "approval_log" add constraint "approval_log_action_check" check ("action" in ('APPROVE', 'REJECT', 'RETURN', 'DELEGATE', 'ESCALATE'));`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "approval_log" drop constraint if exists "approval_log_action_check";`);
    // Drop any escalation rows before narrowing the constraint so the check can re-apply.
    this.addSql(`delete from "approval_log" where "action" = 'ESCALATE';`);
    this.addSql(
      `alter table "approval_log" add constraint "approval_log_action_check" check ("action" in ('APPROVE', 'REJECT', 'RETURN', 'DELEGATE'));`,
    );

    this.addSql(`alter table "workflow_step" drop column "condition_json";`);
  }
}
