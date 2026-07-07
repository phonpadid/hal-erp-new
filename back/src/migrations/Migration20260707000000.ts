import { Migration } from '@mikro-orm/migrations';

/**
 * Chart of accounts (first accounting slice). Adds the per-company `account` master and a
 * nullable `budget.account_id` FK resolved from `gl_account` at write time. Company-scoped
 * (invariant 1); `(company_id, code)` unique. Append-only ledgers are untouched — this adds
 * a master + validation only, no posting. Additive; `account_id` is nullable so pre-existing
 * budgets are non-blocking until backfilled.
 */
export class Migration20260707000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "account" (
      "id" uuid not null,
      "company_id" uuid not null,
      "code" varchar(255) not null,
      "name" varchar(255) not null,
      "account_type" text check ("account_type" in ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE')) not null,
      "parent_id" uuid null,
      "is_postable" boolean not null default true,
      "is_active" boolean not null default true,
      constraint "account_pkey" primary key ("id")
    );`);
    this.addSql(
      `alter table "account" add constraint "account_company_id_code_unique" unique ("company_id", "code");`,
    );
    this.addSql(
      `create index "account_company_id_parent_id_index" on "account" ("company_id", "parent_id");`,
    );
    this.addSql(
      `alter table "account" add constraint "account_company_id_foreign" foreign key ("company_id") references "company" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "account" add constraint "account_parent_id_foreign" foreign key ("parent_id") references "account" ("id") on update cascade on delete set null;`,
    );

    this.addSql(`alter table "budget" add column "account_id" uuid null;`);
    this.addSql(
      `alter table "budget" add constraint "budget_account_id_foreign" foreign key ("account_id") references "account" ("id") on update cascade on delete set null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "budget" drop constraint if exists "budget_account_id_foreign";`);
    this.addSql(`alter table "budget" drop column "account_id";`);
    this.addSql(`drop table if exists "account" cascade;`);
  }
}
