import { Migration } from '@mikro-orm/migrations';

/**
 * Make `document_type` company-owned (invariant 1). It was global with a globally-unique `code`.
 *
 *  1. Add `company_id` (nullable), backfill every existing type to the primary company (the
 *     earliest company), then set NOT NULL + FK.
 *  2. Swap the global unique on `code` for a per-company unique `(company_id, code)`.
 *  3. Deactivate any `dept_doc_type` whose department's company differs from the type's new
 *     company, so no cross-company mapping survives the un-merge.
 *
 * Forward-only for data: the down migration restores the structure, but per-company code
 * divergence created afterward cannot be collapsed back to one global code space.
 */
export class Migration20260713000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "document_type" add column "company_id" uuid null;`);
    this.addSql(
      `update "document_type" set "company_id" = (select "id" from "company" order by "created_at" asc nulls last limit 1) where "company_id" is null;`,
    );
    this.addSql(`alter table "document_type" alter column "company_id" set not null;`);
    this.addSql(
      `alter table "document_type" add constraint "document_type_company_id_foreign" foreign key ("company_id") references "company" ("id") on update cascade;`,
    );
    this.addSql(`alter table "document_type" drop constraint if exists "document_type_code_unique";`);
    this.addSql(
      `alter table "document_type" add constraint "document_type_company_id_code_unique" unique ("company_id", "code");`,
    );
    // Un-merge: any department mapped to a type of a different company loses that mapping.
    this.addSql(
      `update "dept_doc_type" set "is_active" = false where "id" in (` +
        `select dd."id" from "dept_doc_type" dd ` +
        `join "department" d on dd."department_id" = d."id" ` +
        `join "document_type" dt on dd."document_type_id" = dt."id" ` +
        `where d."company_id" <> dt."company_id");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "document_type" drop constraint if exists "document_type_company_id_code_unique";`);
    this.addSql(`alter table "document_type" add constraint "document_type_code_unique" unique ("code");`);
    this.addSql(`alter table "document_type" drop constraint if exists "document_type_company_id_foreign";`);
    this.addSql(`alter table "document_type" drop column "company_id";`);
  }
}
