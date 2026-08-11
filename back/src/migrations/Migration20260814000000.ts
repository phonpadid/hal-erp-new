import { Migration } from '@mikro-orm/migrations';

/**
 * Give the general ledger a month it can close.
 *
 * Every financial statement ranges over `journal_entry.entry_date`, and until now any date was
 * writable at any time — so a figure could enter a month whose income statement had already been
 * printed and acted on. `fiscal_year` guards a different thing (submitting a budget-consuming
 * document) and is annual, so it cannot answer "is July finished?".
 *
 * No backfill and no default period. A company with none declared is in exactly its current state:
 * the guard posts normally for a date no period covers, which is what lets this ship ahead of
 * anyone adopting it.
 */
export class Migration20260814000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "accounting_period" (
        "id" uuid not null,
        "company_id" uuid not null,
        "fiscal_year_id" uuid not null,
        "code" varchar(255) not null,
        "period_start" date not null,
        "period_end" date not null,
        "status" text check ("status" in ('OPEN', 'CLOSED')) not null default 'OPEN',
        "created_at" timestamptz null,
        "updated_at" timestamptz null,
        constraint "accounting_period_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `alter table "accounting_period" add constraint "accounting_period_company_id_foreign" ` +
        `foreign key ("company_id") references "company" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "accounting_period" add constraint "accounting_period_fiscal_year_id_foreign" ` +
        `foreign key ("fiscal_year_id") references "fiscal_year" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "accounting_period" add constraint "accounting_period_company_id_code_unique" ` +
        `unique ("company_id", "code");`,
    );
    // The guard's query is "which period covers this company's date", answered by scanning from
    // period_start; the close's ordering check reads the same index.
    this.addSql(
      `create index "accounting_period_company_id_period_start_index" ` +
        `on "accounting_period" ("company_id", "period_start");`,
    );

    this.addSql(`
      create table "accounting_period_log" (
        "id" uuid not null,
        "period_id" uuid not null,
        "action" text check ("action" in ('CLOSE', 'REOPEN')) not null,
        "acted_by" uuid not null,
        "acted_at" timestamptz not null,
        "reason" text null,
        constraint "accounting_period_log_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `alter table "accounting_period_log" add constraint "accounting_period_log_period_id_foreign" ` +
        `foreign key ("period_id") references "accounting_period" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "accounting_period_log" add constraint "accounting_period_log_acted_by_foreign" ` +
        `foreign key ("acted_by") references "app_user" ("id") on update cascade;`,
    );
    this.addSql(
      `create index "accounting_period_log_period_id_acted_at_index" ` +
        `on "accounting_period_log" ("period_id", "acted_at");`,
    );
  }

  override async down(): Promise<void> {
    // Dropping the log discards the only record of who closed or reopened a month and why. The
    // journal is unaffected — no accounting value lives here — but that history cannot be rebuilt
    // from anything else, unlike the period rows themselves, which are a declaration.
    this.addSql(`drop table if exists "accounting_period_log" cascade;`);
    this.addSql(`drop table if exists "accounting_period" cascade;`);
  }
}
