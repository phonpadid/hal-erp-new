import { Migration } from '@mikro-orm/migrations';

/**
 * `document_intake_log` — finance registering that a document reached their desk.
 *
 * Append-only (invariant 2): a reversal is a new `REVERSE` row, never the removal of the `RECEIVE`
 * it undoes, so a document may legitimately carry `RECEIVE, REVERSE, RECEIVE`. That is why there
 * is no unique index on `document_id` — "received" is derived from the LATEST row and cannot be
 * expressed as uniqueness. Concurrency is held instead by locking the `document` row before the
 * latest row is read.
 *
 * Nothing is backfilled. There is no record of which documents finance received before this
 * existed, and inventing one would put fictional names on an append-only log.
 */
export class Migration20260921000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "document_intake_log" (
      "id" uuid not null,
      "company_id" uuid not null,
      "document_id" uuid not null,
      "action" varchar(255) not null,
      "actor_id" uuid not null,
      "acted_at" timestamptz not null,
      "note" varchar(255) null,
      constraint "document_intake_log_pkey" primary key ("id")
    );`);

    this.addSql(
      'alter table "document_intake_log" add constraint "document_intake_log_company_id_foreign" ' +
        'foreign key ("company_id") references "company" ("id") on update cascade;',
    );
    this.addSql(
      'alter table "document_intake_log" add constraint "document_intake_log_document_id_foreign" ' +
        'foreign key ("document_id") references "document" ("id") on update cascade;',
    );
    this.addSql(
      'alter table "document_intake_log" add constraint "document_intake_log_actor_id_foreign" ' +
        'foreign key ("actor_id") references "app_user" ("id") on update cascade;',
    );

    // The per-document read: the latest row decides the state.
    this.addSql(
      'create index "document_intake_log_document_id_acted_at_index" on "document_intake_log" ("document_id", "acted_at");',
    );
    // The weekly read: what did this company take in between two dates.
    this.addSql(
      'create index "document_intake_log_company_id_acted_at_index" on "document_intake_log" ("company_id", "acted_at");',
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "document_intake_log" cascade;');
  }
}
