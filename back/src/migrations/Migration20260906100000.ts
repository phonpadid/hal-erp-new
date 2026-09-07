import { Migration } from '@mikro-orm/migrations';

/**
 * `approval_log.action` admits `RESTATE_RATE`.
 *
 * A document's rate can now be corrected by the person who converted the money, while the document
 * is still refusable — which changes what the document is WORTH, mid-route, between approvals. That
 * belongs in the same append-only trail as the approvals it happens between: without a row there, a
 * document whose value moved is indistinguishable from one that never moved, and the approvals
 * sitting either side of the change read as though they were given on the same figure.
 *
 * Widening a CHECK only. No row changes, nothing is backfilled, and every existing row stays valid.
 *
 * `down()` re-narrows it, which is safe only for a deploy that wrote no `RESTATE_RATE` row. Rolling
 * back past rows that exist would mean deleting history from an append-only table (invariant 2) —
 * leave the constraint widened in that case; an admitted value nobody writes costs nothing.
 */
const ACTIONS = ['APPROVE', 'REJECT', 'RETURN', 'ESCALATE', 'CANCEL'];
const CONSTRAINT = 'approval_log_action_check';

export class Migration20260906100000 extends Migration {
  override async up(): Promise<void> {
    const values = [...ACTIONS, 'RESTATE_RATE'].map((a) => `'${a}'`).join(', ');
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
  }
}
