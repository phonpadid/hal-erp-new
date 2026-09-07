import { Migration } from '@mikro-orm/migrations';

/** Kept in step with `Migration20260905000000`, which owns this rule. */
const TEMPLATES = ['LETTER', 'PR', 'PO', 'RECEIPT'];
const ONE = `(${TEMPLATES.join('|')})`;
/** Kept in step with `Migration20260906000000`, which owns this rule. */
const TRANSFER_SOURCES = ['PRIMARY', 'RESERVE'];

/**
 * Reconciles the schema after four migration timestamps collided in a branch merge.
 *
 * `Migration20260904000000`, `…05000000` and `…06000000` each name TWO different migrations — one
 * written on master, one on this branch. A file name has a single owner, so the merge kept the
 * branch's three and master's three left the tree, while the entity fields all three existed to
 * support came across intact. Worse, the collision is symmetric: every database records those three
 * names as applied, so whichever side's statements a database happens to be missing can never be
 * delivered under those names again.
 *
 * That leaves three possible states, and this migration is written to bring any of them to the same
 * place:
 *
 *  - A database built from this branch has the branch's columns (`print_templates`, `actual_rate`,
 *    `transfer_from`) and lacks master's three.
 *  - A database built from master — production, if it has shipped master — is the exact mirror: it
 *    has master's three and lacks the branch's.
 *  - A database built fresh from this tree today gets the branch's from their own migrations and
 *    master's from here.
 *
 * So every statement below is conditional, and that is the point rather than defensiveness: the
 * same migration has to be a no-op for the half a database already has and the fix for the half it
 * does not, because there is no third name left to split them across. `add column if not exists`
 * and `create index if not exists` say this directly; the constraints need a `do` block, since
 * Postgres has no `add constraint if not exists` — and re-adding an existing foreign key would
 * revalidate the whole table for nothing.
 *
 * The column definitions are their originals, verbatim from both sides — same types, same
 * defaults, same `on delete set null`, same check expressions built from the same constants — so a
 * database reaching a column through this file is indistinguishable from one that got it through
 * the migration that first declared it.
 *
 * Nothing here is destructive and nothing is backfilled. Every added column is either nullable or
 * carries the default its owning migration gave it, which is what the rows that predate it already
 * mean: `is_shared` false is an unmarked node, a null account is "post the old way", a null
 * `transfer_from` is a payment nobody has said the source of.
 *
 * `down` is deliberately empty. This migration asserts a state rather than making a change, and it
 * cannot know which half of it a given database owned beforehand — dropping master's three from a
 * master-built database would destroy columns that database's own history says it created.
 */
export class Migration20260907100000 extends Migration {
  private addColumn(table: string, column: string, definition: string): void {
    this.addSql(`alter table "${table}" add column if not exists "${column}" ${definition};`);
  }

  /** `add constraint` only where it is absent — Postgres offers no `if not exists` for these. */
  private addConstraint(table: string, name: string, body: string): void {
    this.addSql(
      `do $$ begin if not exists (select 1 from pg_constraint where conname = '${name}') then ` +
        `alter table "${table}" add constraint "${name}" ${body}; end if; end $$;`,
    );
  }

  override async up(): Promise<void> {
    // ── master's Migration20260904000000 ──────────────────────────────────────────────────────
    // Money the whole company draws on. Declared, never derived: which budgets are shared lives in
    // people's heads, so every existing node is correctly false until somebody says otherwise.
    this.addColumn('budget_node', 'is_shared', `boolean not null default false`);

    // ── master's Migration20260905000000 ──────────────────────────────────────────────────────
    // The budget whose missing account stopped the last posting attempt — the cause as data.
    // `on delete set null` so the attempt outlives its budget: losing which budget it was costs an
    // error message, deleting the attempt would lose the debt itself.
    this.addColumn('gl_posting_attempt', 'blocked_by_budget_id', `uuid null`);
    this.addConstraint(
      'gl_posting_attempt',
      'gl_posting_attempt_blocked_by_budget_id_foreign',
      `foreign key ("blocked_by_budget_id") references "budget" ("id") on update cascade on delete set null`,
    );
    this.addSql(
      `create index if not exists "gl_posting_attempt_blocked_by_budget_id_index" on "gl_posting_attempt" ("blocked_by_budget_id");`,
    );

    // ── master's Migration20260906000000 ──────────────────────────────────────────────────────
    // The account a line posts to, when it names one of its own. Nullable permanently: lines
    // submitted before the column existed carry none and fall back to the budget's account.
    this.addColumn('document_line', 'account_id', `uuid null`);
    this.addConstraint(
      'document_line',
      'document_line_account_id_foreign',
      `foreign key ("account_id") references "account" ("id") on update cascade on delete set null`,
    );
    this.addSql(
      `create index if not exists "document_line_account_id_index" on "document_line" ("account_id");`,
    );

    // ── this branch's Migration20260904000000 + …05000000 ─────────────────────────────────────
    // The sheets a type prints as, already in its post-rename plural form: a database missing the
    // column never had the singular `print_template` to rename, so it is created as what the two
    // migrations together arrive at rather than created and then renamed.
    this.addColumn('document_type', 'print_templates', `varchar(255) not null default 'LETTER'`);
    this.addConstraint(
      'document_type',
      'document_type_print_templates_check',
      `check ("print_templates" ~ '^${ONE}(,${ONE})*$')`,
    );

    // ── this branch's Migration20260906000000 ─────────────────────────────────────────────────
    // The rate the money actually converted at, stated with the slip.
    this.addColumn('payment_attachment', 'actual_rate', `numeric(18,8) null`);
    const values = TRANSFER_SOURCES.map((t) => `'${t}'`).join(', ');
    for (const table of ['payment', 'payment_attachment']) {
      this.addColumn(table, 'transfer_from', `varchar(255) null`);
      this.addConstraint(
        table,
        `${table}_transfer_from_check`,
        `check ("transfer_from" is null or "transfer_from" in (${values}))`,
      );
    }
  }

  override async down(): Promise<void> {
    // Intentionally empty — see the note above: this migration cannot know which half of the
    // schema it asserted was already a given database's own.
  }
}
