import { Migration } from '@mikro-orm/migrations';

/**
 * Two pieces of configuration that nothing honours.
 *
 * `workflow.condition_json` was meant to select the workflow — `web-doc-config` promised an editor
 * for it and the detail view summarised it back — but selection is the `dept_doc_type` mapping
 * alone, and only `workflow_step.condition_json` reaches the routing engine. An administrator could
 * author a rule, see it echoed, and route nothing by it. Configuration nothing reads is worse than
 * configuration that does not exist, because it is believed. Everything it claimed to express
 * (amount band, position level) is expressed by the step columns that do route.
 *
 * `DELEGATE` was an approval action that changed no state: its branch in the routing engine is a
 * bare `break`, and delegation actually happens through `approval_delegation`, which this action
 * never wrote. Nothing has ever written the value, so the check constraint is narrowed rather than
 * migrated around — there are no rows to keep readable.
 */
export class Migration20260826000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "workflow" drop column "condition_json";`);

    this.addSql(`alter table "approval_log" drop constraint if exists "approval_log_action_check";`);
    this.addSql(
      `alter table "approval_log" add constraint "approval_log_action_check" ` +
        `check ("action" in ('APPROVE', 'REJECT', 'RETURN', 'ESCALATE'));`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "approval_log" drop constraint if exists "approval_log_action_check";`);
    this.addSql(
      `alter table "approval_log" add constraint "approval_log_action_check" ` +
        `check ("action" in ('APPROVE', 'REJECT', 'RETURN', 'DELEGATE', 'ESCALATE'));`,
    );

    this.addSql(`alter table "workflow" add column "condition_json" text null;`);
  }
}
