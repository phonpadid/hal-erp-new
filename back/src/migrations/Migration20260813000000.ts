import { Migration } from '@mikro-orm/migrations';

/**
 * Give the general ledger somewhere to say what it failed to post.
 *
 * Until now a posting failure was a `logger.error` and nothing else, so "which postings are owed
 * and missing?" had no answer. This table holds one row per posting source, keyed on the same
 * `(company_id, source_type, source_id)` that `journal_entry` is already unique on.
 *
 * It is a WORK RECORD, not a ledger: rows change status in place, so it is deliberately outside
 * `LedgerGuardSubscriber`. `journal_entry` stays the authority on whether a posting happened.
 *
 * No backfill. A source that failed before this shipped has no row, which is indistinguishable
 * from one that was never attempted — and that is precisely what the reconciliation pass looks
 * for, so the first sweep after deploy finds them. Manufacturing rows here would guess at
 * histories the log no longer holds.
 */
export class Migration20260813000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "gl_posting_attempt" (
        "id" uuid not null,
        "company_id" uuid not null,
        "source_type" varchar(255) not null,
        "source_id" uuid not null,
        "status" text check ("status" in ('PENDING', 'POSTED', 'SKIPPED', 'FAILED')) not null default 'PENDING',
        "attempts" int not null default 0,
        "last_error" text null,
        "last_attempt_at" timestamptz null,
        "created_at" timestamptz null,
        "updated_at" timestamptz null,
        constraint "gl_posting_attempt_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `alter table "gl_posting_attempt" add constraint "gl_posting_attempt_company_id_foreign" ` +
        `foreign key ("company_id") references "company" ("id") on update cascade;`,
    );
    // The idempotency key: one row per source, mirroring journal_entry's own unique key so the two
    // can be joined and compared without a second notion of identity.
    this.addSql(
      `alter table "gl_posting_attempt" add constraint ` +
        `"gl_posting_attempt_company_id_source_type_source_id_unique" ` +
        `unique ("company_id", "source_type", "source_id");`,
    );
    // The sweep's claim query and the undelivered read both filter by company + status.
    this.addSql(
      `create index "gl_posting_attempt_company_id_status_index" ` +
        `on "gl_posting_attempt" ("company_id", "status");`,
    );
  }

  override async down(): Promise<void> {
    // Dropping this loses every recorded error and every SKIPPED marker. The journal is unaffected
    // — nothing here is accounting data — but the next reconciliation pass will re-offer every
    // legitimately skipped source as owed, because the answer it was remembering is gone.
    this.addSql(`drop table if exists "gl_posting_attempt" cascade;`);
  }
}
