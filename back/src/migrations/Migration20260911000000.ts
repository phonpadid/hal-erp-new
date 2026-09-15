import { Migration } from '@mikro-orm/migrations';

/**
 * A workflow step may let its approver re-code the account a line posts to.
 *
 * `document_line.account_id` is resolved from configuration once, at submit, and never re-derived
 * — an item's default GL edited after approval must not move the account a settlement debits. But
 * "never re-derived from configuration" had been read as "never changed by anyone", and the people
 * who know the chart of accounts are the last step of every HAL disbursement route. A budget the
 * plan spends across several accounts reached the ledger on the one account the budget names,
 * because nobody between submit and posting could say otherwise.
 *
 * Two columns and one widened check:
 *
 * - `workflow_step.allows_account_recode` — configuration: which step may.
 * - `document_approval_step.allows_account_recode` — the copy taken at submit, which is what the
 *   service reads. Same reason `requires_payment_slip` is copied: the route is what the document is
 *   running, so a flag turned on reaches documents submitted afterwards and cannot change the terms
 *   of one already in approval.
 * - `approval_log.action` admits `RECODE_ACCOUNT`, beside `RESTATE_RATE`. A line whose account moved
 *   between two approvals must be visible between them, attributed, with what it moved from.
 *
 * Nothing is backfilled; every existing row stays valid at the default.
 *
 * `down()` drops the columns and re-narrows the check, which is safe only for a deploy that wrote
 * no `RECODE_ACCOUNT` row. Rolling back past rows that exist would mean deleting history from an
 * append-only table (invariant 2) — leave the constraint widened in that case; an admitted value
 * nobody writes costs nothing.
 */
const ACTIONS = ['APPROVE', 'REJECT', 'RETURN', 'ESCALATE', 'CANCEL', 'RESTATE_RATE'];
const CONSTRAINT = 'approval_log_action_check';

export class Migration20260911000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "workflow_step" add column "allows_account_recode" boolean not null default false;`,
    );
    this.addSql(
      `alter table "document_approval_step" add column "allows_account_recode" boolean not null default false;`,
    );
    const values = [...ACTIONS, 'RECODE_ACCOUNT'].map((a) => `'${a}'`).join(', ');
    this.addSql(`alter table "approval_log" drop constraint if exists "${CONSTRAINT}";`);
    this.addSql(
      `alter table "approval_log" add constraint "${CONSTRAINT}" check ("action" in (${values}));`,
    );
  }

  override async down(): Promise<void> {
    const values = ACTIONS.map((a) => `'${a}'`).join(', ');
    this.addSql(`alter table "approval_log" drop constraint if exists "${CONSTRAINT}";`);
    this.addSql(
      `alter table "approval_log" add constraint "${CONSTRAINT}" check ("action" in (${values}));`,
    );
    this.addSql(`alter table "document_approval_step" drop column "allows_account_recode";`);
    this.addSql(`alter table "workflow_step" drop column "allows_account_recode";`);
  }
}
