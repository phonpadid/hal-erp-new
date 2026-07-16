import { Migration } from '@mikro-orm/migrations';

/**
 * Bound three string columns that earlier migrations left unbounded, bringing them in line with
 * every other `varchar` column in the DBML and silencing a standing `schema:update` diff:
 *
 * - `document_type.category` was `text`
 * - `document_type.default_gl_account` was unbounded `varchar`
 * - `item_company.default_gl_account` was unbounded `varchar`
 *
 * The DBML types all three as plain `varchar`, which this codebase implements as `varchar(255)`
 * everywhere else — these were the only string columns that escaped it, so the entities (which all
 * declare a plain `@Property()` string) reported drift against them forever.
 *
 * Safe to narrow: all three hold short codes. `category` is a `document_category.code`, and both
 * `default_gl_account` columns are GL codes validated against the chart of accounts. The longest
 * value in any of them at the time of writing was 11 characters. The guard below aborts the
 * transaction rather than silently truncating if that is ever untrue.
 */
export class Migration20260723000000 extends Migration {
  override async up(): Promise<void> {
    // Refuse to truncate: abort if any value would not survive the narrowing.
    this.addSql(`
      do $$
      declare cnt int;
      begin
        select
          (select count(*) from "document_type" where length("category") > 255)
          + (select count(*) from "document_type" where length("default_gl_account") > 255)
          + (select count(*) from "item_company" where length("default_gl_account") > 255)
        into cnt;
        if cnt > 0 then
          raise exception 'varchar(255) narrowing would truncate % value(s); aborting', cnt;
        end if;
      end $$;
    `);

    this.addSql(
      `alter table "document_type" alter column "category" type varchar(255) using ("category"::varchar(255));`,
    );
    this.addSql(
      `alter table "document_type" alter column "default_gl_account" type varchar(255) using ("default_gl_account"::varchar(255));`,
    );
    this.addSql(
      `alter table "item_company" alter column "default_gl_account" type varchar(255) using ("default_gl_account"::varchar(255));`,
    );
  }

  override async down(): Promise<void> {
    // Restore the original, wider types. Always safe — widening never loses data.
    this.addSql(
      `alter table "document_type" alter column "category" type text using ("category"::text);`,
    );
    this.addSql(
      `alter table "document_type" alter column "default_gl_account" type varchar using ("default_gl_account"::varchar);`,
    );
    this.addSql(
      `alter table "item_company" alter column "default_gl_account" type varchar using ("default_gl_account"::varchar);`,
    );
  }
}
