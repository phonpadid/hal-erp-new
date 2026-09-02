import { Migration } from '@mikro-orm/migrations';

/**
 * The requester's own withdrawal becomes an act, not just a status.
 *
 * `cancel()` set `document.status = CANCELLED` and released the holds. Nothing was written to
 * `approval_log`, so the history of a document that reached step 2 and was withdrawn read:
 * submitted, approved at step 1, then nothing — for a document that is now CANCELLED. Every other
 * terminal outcome names its actor there; this one left the reader to infer the actor from
 * `document.created_by` and the time from a mutable `updated_at`.
 *
 * `CANCEL` is the requester withdrawing their own pending request. It is not `REJECT`, which is an
 * approver refusing someone else's — same terminal effect on the holds, opposite meaning in the
 * record.
 */
export class Migration20260827000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "approval_log" drop constraint if exists "approval_log_action_check";`);
    this.addSql(
      `alter table "approval_log" add constraint "approval_log_action_check" ` +
        `check ("action" in ('APPROVE', 'REJECT', 'RETURN', 'ESCALATE', 'CANCEL'));`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "approval_log" drop constraint if exists "approval_log_action_check";`);
    // Drop the withdrawal rows before narrowing, so the check can re-apply.
    this.addSql(`delete from "approval_log" where "action" = 'CANCEL';`);
    this.addSql(
      `alter table "approval_log" add constraint "approval_log_action_check" ` +
        `check ("action" in ('APPROVE', 'REJECT', 'RETURN', 'ESCALATE'));`,
    );
  }
}
