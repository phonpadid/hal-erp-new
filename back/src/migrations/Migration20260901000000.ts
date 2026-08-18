import { Migration } from '@mikro-orm/migrations';

/**
 * Two things a document type could not say about itself.
 *
 * `requires_employee` — the fifth flag of the shape `requires_vendor` / `requires_item` /
 * `requires_payee` / `requires_warehouse` already have. The HR post-actions act on
 * `document.related_employee` and are a logged no-op when it is absent, which is right for a
 * post-action handed a document with no subject and wrong as an outcome a form can produce: a
 * promotion naming nobody routes through every approval step, is approved, reaches COMPLETED, and
 * changes no employee record. The approver is told it succeeded.
 *
 * `authoring_route` — where this type's content is written. Null means the generic create wizard
 * can write everything the type carries. A value names the client route of the screen that can.
 * Budget plans, adjustments and transfers keep their content on `budget_movement`; a voucher keeps
 * its two sides on `journal_voucher`. For those the wizard produces a well-formed EMPTY document,
 * which submits, enters the approval queue, and is refused by its post-action when an approver
 * finally clicks — leaving a document that cannot be approved and will not go away.
 *
 * Not derived from `post_action`: that column answers what full approval DOES, which is a different
 * question from where the content is WRITTEN, and deriving one from the other would put the answer
 * in code rather than configuration (invariant 7).
 *
 * Not expressed by removing the `dept_doc_type` mapping either, which was the first idea and is
 * impossible: `DocumentService.createDraft` resolves that mapping for every document including the
 * ones a dedicated screen creates, so a type without one cannot be raised at all — dropping it
 * would break the very screens this column points at.
 */
export class Migration20260901000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "document_type" add column "requires_employee" boolean not null default false;`,
    );
    this.addSql(`alter table "document_type" add column "authoring_route" varchar null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "document_type" drop column "authoring_route";`);
    this.addSql(`alter table "document_type" drop column "requires_employee";`);
  }
}
