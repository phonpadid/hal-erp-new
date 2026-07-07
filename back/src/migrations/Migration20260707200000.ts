import { Migration } from '@mikro-orm/migrations';

/**
 * Purchase tax — VAT slice. Adds the per-company `tax_code` master and the tax columns on
 * `document_line` (tax_code_id + tax_amount) and `document` (sub_total / tax_total / grand_total /
 * base_tax_total). Additive; untaxed documents keep `tax_amount` 0 and null totals. No change to
 * `budget_txn` — input VAT does not touch the budget.
 */
export class Migration20260707200000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "tax_code" (
      "id" uuid not null,
      "company_id" uuid not null,
      "code" varchar(255) not null,
      "name" varchar(255) not null,
      "kind" text check ("kind" in ('VAT', 'WHT')) not null,
      "rate" numeric(9,6) not null,
      "is_active" boolean not null default true,
      constraint "tax_code_pkey" primary key ("id")
    );`);
    this.addSql(
      `alter table "tax_code" add constraint "tax_code_company_id_code_unique" unique ("company_id", "code");`,
    );
    this.addSql(
      `alter table "tax_code" add constraint "tax_code_company_id_foreign" foreign key ("company_id") references "company" ("id") on update cascade;`,
    );

    this.addSql(`alter table "document_line" add column "tax_code_id" uuid null;`);
    this.addSql(`alter table "document_line" add column "tax_amount" numeric(15,2) not null default 0;`);
    this.addSql(
      `alter table "document_line" add constraint "document_line_tax_code_id_foreign" foreign key ("tax_code_id") references "tax_code" ("id") on update cascade on delete set null;`,
    );

    this.addSql(`alter table "document" add column "sub_total" numeric(15,2) null;`);
    this.addSql(`alter table "document" add column "tax_total" numeric(15,2) null;`);
    this.addSql(`alter table "document" add column "grand_total" numeric(15,2) null;`);
    this.addSql(`alter table "document" add column "base_tax_total" numeric(15,2) null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "document" drop column "base_tax_total";`);
    this.addSql(`alter table "document" drop column "grand_total";`);
    this.addSql(`alter table "document" drop column "tax_total";`);
    this.addSql(`alter table "document" drop column "sub_total";`);
    this.addSql(`alter table "document_line" drop constraint if exists "document_line_tax_code_id_foreign";`);
    this.addSql(`alter table "document_line" drop column "tax_amount";`);
    this.addSql(`alter table "document_line" drop column "tax_code_id";`);
    this.addSql(`drop table if exists "tax_code" cascade;`);
  }
}
