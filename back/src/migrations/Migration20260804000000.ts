import { Migration } from '@mikro-orm/migrations';

/**
 * Telling a retry apart from a second claim.
 *
 * An external system is about to create documents over HTTP, and HTTP retries. Today a document
 * carries no trace of where it came from — `ref_document_id` names a predecessor in this system
 * and `related_employee_id` names a person in this system, and neither can hold "claim CLM-B-8842
 * over there". So a retry after a timeout is indistinguishable from a genuine second claim, and
 * because a claim is submitted as soon as it is created, the second document reserves the budget
 * again. `budget_txn` is append-only, so that reservation cannot be deleted — it has to be
 * answered with a compensating RELEASE by whoever eventually notices the budget draining faster
 * than the claims justify.
 *
 * `journal_entry` already solved this, and its note says why: idempotent per source so event
 * retries never double-post. This gives `document` the same pair for the same reason.
 *
 * The unique index is PARTIAL. Documents raised in the web app carry neither column, and there are
 * many of them — a plain unique index would collapse them all into one allowed row. `WHERE
 * source_id IS NOT NULL` constrains exactly the rows that claim an external identity and leaves
 * every other document alone. MikroORM's schema generator does not model partial indexes, so this
 * one is written here by hand and will not be produced by a diff.
 *
 * Purely additive and inert on existing data: every current row simply has both columns null.
 */
export class Migration20260804000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "document" add column "source_type" varchar(255) null;`);
    this.addSql(`alter table "document" add column "source_id" varchar(255) null;`);
    this.addSql(
      `create unique index "document_company_source_unique" on "document" ` +
        `("company_id", "source_type", "source_id") where "source_id" is not null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "document_company_source_unique";`);
    this.addSql(`alter table "document" drop column if exists "source_id";`);
    this.addSql(`alter table "document" drop column if exists "source_type";`);
  }
}
