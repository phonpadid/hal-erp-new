import { Migration } from '@mikro-orm/migrations';

/**
 * Make document-type categories company-scoped configuration instead of the hardcoded
 * `doc_category` enum (invariant 7 — config over code; invariant 1 — company isolation).
 *
 * Creates `document_category` (company-scoped, unique per (company_id, code)), seeds the five
 * canonical codes for every company, and drops the CHECK constraint that pinned
 * `document_type.category` to the old enum values. `document_type.category` stays a text *code*
 * (validated in the service against `document_category`, like `default_gl_account` references a GL
 * code) — so no column swap or backfill of document types is needed and every existing
 * document type keeps its category value.
 */
export class Migration20260718000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "document_category" (
      "id" uuid not null,
      "company_id" uuid not null,
      "code" varchar(255) not null,
      "name" varchar(255) not null,
      "is_active" boolean not null default true,
      constraint "document_category_pkey" primary key ("id")
    );`);
    this.addSql(
      `alter table "document_category" add constraint "document_category_company_id_code_unique" unique ("company_id", "code");`,
    );
    this.addSql(
      `alter table "document_category" add constraint "document_category_company_id_foreign" foreign key ("company_id") references "company" ("id") on update cascade;`,
    );

    // Seed the five canonical categories for every company. Idempotent via the unique constraint.
    this.addSql(`insert into "document_category" ("id", "company_id", "code", "name", "is_active")
      select gen_random_uuid(), c."id", v."code", v."name", true
      from "company" c
      cross join (values
        ('PROCUREMENT', 'Procurement'),
        ('FINANCE', 'Finance'),
        ('HR', 'HR'),
        ('ADMIN', 'Admin'),
        ('IT', 'IT')
      ) as v("code", "name")
      on conflict ("company_id", "code") do nothing;`);

    // Categories are now data, not a fixed enum: drop the CHECK that pinned category to the old
    // values so a company can use its own category codes. The column stays a text code.
    this.addSql(`alter table "document_type" drop constraint if exists "document_type_category_check";`);
  }

  override async down(): Promise<void> {
    // Restore the old enum CHECK (best-effort: fails if any type uses a non-canonical code).
    this.addSql(
      `alter table "document_type" add constraint "document_type_category_check" check ("category" in ('PROCUREMENT', 'FINANCE', 'HR', 'ADMIN', 'IT'));`,
    );
    this.addSql(`drop table if exists "document_category" cascade;`);
  }
}
