import { Migration } from '@mikro-orm/migrations';

/**
 * A transfer slip becomes evidence a step can be approved against, instead of a receipt filed after.
 *
 * Today a slip cannot exist before the approval it is meant to justify. `payment_attachment` hangs
 * off `payment` by a NOT NULL reference, and a `payment` row is written only by
 * `recordPayment`, which runs after a document is fully approved. So on a workflow where finance
 * transfers the money mid-route and a later approver signs off on a transfer that has already
 * happened, the evidence for that signature can only arrive after every signature is in.
 *
 * The fix is to move the anchor rather than add a second one. `document_id` becomes the fact a slip
 * always carries — a slip evidences money moving for a document — and `payment_id` becomes the
 * optional second fact, filled in when the system's own record of that money exists. The public
 * routes need no change: they were keyed by document id all along and only converted it to a
 * payment internally.
 *
 * `workflow_step.requires_payment_slip` is what makes it a rule rather than a habit. It is read from
 * the step the document is currently on — not from its type, its amount or its step number — so
 * which step demands evidence is configuration (invariant 7), not a constant in the approve path.
 *
 * The backfill is total, not best-effort: `payment.document_id` is NOT NULL, so every existing
 * attachment already knows its document through its payment. `document_id` is set NOT NULL only
 * AFTER the backfill, so a row that somehow had no document fails this migration loudly instead of
 * being quietly handed one. `payment_id` is made nullable LAST, so the state "no payment" only
 * becomes representable once every row already names its document.
 *
 * No ledger is touched. Evidence settles nothing: the budget went to ACTUAL when the document
 * completed, and a picture of a transfer does not move it again (invariant 3).
 *
 * `down` is not lossless, and cannot be. Slips uploaded mid-approval have no payment, and a restored
 * NOT NULL `payment_id` has no value to give them, so they are deleted. Their bytes stay in object
 * storage — a schema rollback should not destroy evidence — but the rows that made them findable go.
 *
 * Renamed from `Migration20260903000000` when this branch was merged: master had already
 * taken that timestamp for an unrelated migration, and two migrations cannot share a name.
 * Moved to the end of the sequence rather than squeezed between existing ones — it is
 * additive and order-independent, and renumbering anything already applied would make the
 * migrations table disagree with the files.
 */
export class Migration20260907000000 extends Migration {
  override async up(): Promise<void> {
    // Additive with a default: every existing step is valid the moment the column exists, and a
    // step nobody has configured demands nothing.
    this.addSql(
      `alter table "workflow_step" add column "requires_payment_slip" boolean not null default false;`,
    );
    // The same flag on the route a document actually runs. `document_approval_step` is a snapshot
    // taken at submit — it already copies `approve_mode`, `sla_hours`, the escalation targets and
    // `show_signature_on_pdf` — and the approve path reads that snapshot, never the live
    // configuration. Without the column here the gate would have nothing to read; with it, turning
    // the requirement on reaches documents submitted afterwards and cannot silently change the
    // terms of a document already routing.
    this.addSql(
      `alter table "document_approval_step" add column "requires_payment_slip" boolean not null default false;`,
    );

    this.addSql(`alter table "payment_attachment" add column "document_id" uuid null;`);
    this.addSql(
      `update "payment_attachment" pa set "document_id" = p."document_id" ` +
        `from "payment" p where p."id" = pa."payment_id";`,
    );
    // Fails loudly if the update above left anything unmatched, which it cannot while
    // `payment.document_id` is NOT NULL — but a migration that assumes is a migration that lies.
    this.addSql(`alter table "payment_attachment" alter column "document_id" set not null;`);
    this.addSql(
      `alter table "payment_attachment" add constraint "payment_attachment_document_id_foreign" ` +
        `foreign key ("document_id") references "document" ("id") on update cascade;`,
    );
    // The question every reader now asks: this document's slips.
    this.addSql(
      `create index "payment_attachment_document_id_index" on "payment_attachment" ("document_id");`,
    );

    // Last. Until this runs, "a slip with no payment" is unrepresentable, which is what makes the
    // backfill above safe to reason about.
    this.addSql(`alter table "payment_attachment" alter column "payment_id" drop not null;`);
  }

  override async down(): Promise<void> {
    // Rows uploaded mid-approval have no payment and cannot survive the constraint coming back.
    // Deleting them is the only way down; the stored objects are deliberately left alone.
    this.addSql(`delete from "payment_attachment" where "payment_id" is null;`);
    this.addSql(`alter table "payment_attachment" alter column "payment_id" set not null;`);
    this.addSql(`drop index if exists "payment_attachment_document_id_index";`);
    this.addSql(
      `alter table "payment_attachment" drop constraint if exists "payment_attachment_document_id_foreign";`,
    );
    this.addSql(`alter table "payment_attachment" drop column if exists "document_id";`);
    this.addSql(`alter table "document_approval_step" drop column if exists "requires_payment_slip";`);
    this.addSql(`alter table "workflow_step" drop column if exists "requires_payment_slip";`);
  }
}
