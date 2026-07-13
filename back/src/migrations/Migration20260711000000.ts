import { Migration } from '@mikro-orm/migrations';

/**
 * Move an item's GL from the group `item` to the company-scoped `item_company`, and add a
 * per-company vendor payment-term override.
 *
 *  1. Add `item_company.default_gl_account` and `vendor_company.payment_term_days` (nullable).
 *  2. Backfill each `item_company` row's GL from its item's old group `default_gl_account`, so
 *     every enabled company keeps the GL it had (no day-one regression).
 *  3. Drop `item.default_gl_account` — GL now lives only per company.
 *
 * Forward-only for data: the down migration re-adds the group column empty; it cannot restore a
 * single group value from per-company rows that may have diverged.
 */
export class Migration20260711000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "item_company" add column "default_gl_account" varchar null;`);
    this.addSql(`alter table "vendor_company" add column "payment_term_days" int null;`);
    this.addSql(
      `update "item_company" ic set "default_gl_account" = i."default_gl_account" ` +
        `from "item" i where ic."item_id" = i."id" and i."default_gl_account" is not null;`,
    );
    this.addSql(`alter table "item" drop column "default_gl_account";`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "item" add column "default_gl_account" varchar null;`);
    this.addSql(`alter table "vendor_company" drop column "payment_term_days";`);
    this.addSql(`alter table "item_company" drop column "default_gl_account";`);
  }
}
