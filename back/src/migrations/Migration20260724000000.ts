import { Migration } from '@mikro-orm/migrations';

/**
 * Create `pending_successor` — the CREATE_SUCCESSOR outbox. A row records that an approved
 * document owes a successor; it is inserted in the same transaction that marks the source
 * COMPLETED, so the obligation commits atomically with the approval (approval-workflow: a
 * post-action must never leave the document half-applied). A sweeper fulfils the obligation
 * afterwards, outside that transaction, so a broken successor configuration cannot retroactively
 * fail an approval that its approvers already granted.
 *
 * A work queue, not a ledger: `status`, `attempts`, and `last_error` are updated in place.
 * Invariant 2's append-only rule covers `budget_txn` and `approval_log`, where the history *is*
 * the product; here the audit trail is the existing `approval_log` row plus the created
 * document's own `ref_document_id`.
 *
 * The `(status, created_at)` index serves the sweeper's claim query, which reads only PENDING
 * rows oldest-first — without it the scan degrades as DONE rows accumulate (nothing prunes them
 * yet; retention is a follow-up).
 *
 * Also adds `document_type_ref.successor_department_id` (nullable): the department an auto-created
 * successor is created in, which pins its form template and workflow through `dept_doc_type`. Null
 * keeps the successor in the source document's department; set, it hands the successor to that
 * department — `PROC → PO` into Procurement whichever department raised the requisition. The sweep
 * has no request context to inherit a department from, so this makes the choice configuration
 * (invariant 7) rather than a rule inferred from whoever raised or approved the predecessor.
 *
 * Pure additive: a new table and a nullable column, no backfill, so `down` reverses both. A PROC
 * that already completed without its PO is unaffected and is still created manually, exactly as
 * today; existing pairings default to null, i.e. the source document's department.
 */
export class Migration20260724000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "pending_successor" (
      "id" uuid not null,
      "company_id" uuid not null,
      "source_document_id" uuid not null,
      "successor_type_id" uuid not null,
      "department_id" uuid not null,
      "status" varchar(255) not null default 'PENDING',
      "attempts" int not null default 0,
      "last_error" text null,
      "created_at" timestamptz(6) null,
      "updated_at" timestamptz(6) null,
      constraint "pending_successor_pkey" primary key ("id")
    );`);
    this.addSql(
      `create index "pending_successor_status_created_at_index" on "pending_successor" ("status", "created_at");`,
    );

    this.addSql(
      `alter table "pending_successor" add constraint "pending_successor_company_id_foreign" foreign key ("company_id") references "company" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "pending_successor" add constraint "pending_successor_source_document_id_foreign" foreign key ("source_document_id") references "document" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "pending_successor" add constraint "pending_successor_successor_type_id_foreign" foreign key ("successor_type_id") references "document_type" ("id") on update cascade;`,
    );

    this.addSql(
      `alter table "pending_successor" add constraint "pending_successor_department_id_foreign" foreign key ("department_id") references "department" ("id") on update cascade;`,
    );

    this.addSql(
      `alter table "document_type_ref" add column "successor_department_id" uuid null;`,
    );
    this.addSql(
      `alter table "document_type_ref" add constraint "document_type_ref_successor_department_id_foreign" foreign key ("successor_department_id") references "department" ("id") on update cascade on delete set null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "document_type_ref" drop constraint if exists "document_type_ref_successor_department_id_foreign";`,
    );
    this.addSql(`alter table "document_type_ref" drop column if exists "successor_department_id";`);
    // Any PENDING rows left here are unclaimed obligations — drain the queue (or create those
    // successors by hand) before rolling back, or the work is silently lost.
    this.addSql(`drop table if exists "pending_successor" cascade;`);
  }
}
