import { Migration } from '@mikro-orm/migrations';

/**
 * Make `company.tax_id` nullable — a company may be registered before its tax ID is known.
 * Existing rows are unaffected; the column simply stops being NOT NULL.
 */
export class Migration20260709110000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "company" alter column "tax_id" drop not null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "company" alter column "tax_id" set not null;`);
  }
}
