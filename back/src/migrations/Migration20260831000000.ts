import { Migration } from '@mikro-orm/migrations';

/**
 * Close the set `document_type.post_action` may hold.
 *
 * It was a free-form varchar with no enum and no CHECK, and the set of values it may take was
 * written in five places that disagreed — the DBML note listed seven, the shared form list offered
 * seven, the two validators constrained nothing, and the dispatcher handled twelve. A value outside
 * the twelve reached `default: return` and did nothing, so a misspelling configured a document type
 * that routed through every approval step, wrote its whole `approval_log` trail, reached its
 * terminal state, and cut no budget.
 *
 * `'NONE'` is normalised to null FIRST, then the constraint is added. Those rows are how the admin
 * form spelled "no post-action": its Select cannot hold null, so it submitted its sentinel and the
 * sentinel was stored — a second spelling of absence that took the same silent branch a typo took.
 * The form now resolves it before sending. Adding the constraint first would fail on exactly the
 * rows this exists to clean.
 *
 * `down()` drops the constraint and stops there. It does not put `'NONE'` back: restoring the
 * sentinel restores the ambiguity, and `Migration20260719000000` is the warning — its `down()`
 * rewrites `CREATE_SUCCESSOR` to `CREATE_PO`, a value nothing has dispatched since, which with this
 * constraint in place now fails loudly instead of quietly reinstating a no-op.
 */
const POST_ACTIONS = [
  'CUT_BUDGET',
  'TRANSFER',
  'ADJUST_INCREASE',
  'ADJUST_DECREASE',
  'ACTIVATE_BUDGET',
  'CREATE_SUCCESSOR',
  'ISSUE_STOCK',
  'ADJUST_STOCK',
  'TRANSFER_STOCK',
  'POST_JOURNAL',
  'UPDATE_EMPLOYEE',
  'TERMINATE_EMPLOYEE',
];

export class Migration20260831000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`update "document_type" set "post_action" = null where "post_action" = 'NONE';`);

    // Any row left outside the set fails here, naming itself. That is the intent: a value nobody
    // dispatches is not data to normalise silently, it is a document type that does nothing.
    const values = POST_ACTIONS.map((a) => `'${a}'`).join(', ');
    this.addSql(
      `alter table "document_type" drop constraint if exists "document_type_post_action_check";`,
    );
    this.addSql(
      `alter table "document_type" add constraint "document_type_post_action_check" ` +
        `check ("post_action" is null or "post_action" in (${values}));`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "document_type" drop constraint if exists "document_type_post_action_check";`,
    );
  }
}
