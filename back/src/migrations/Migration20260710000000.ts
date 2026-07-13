import { Migration } from '@mikro-orm/migrations';

/**
 * Add `document_type.requires_item` — when true, every document line must carry an item
 * (procurement goods for receiving / 3-way matching); enforced at submit like
 * `requires_vendor`. Defaults to false, so existing types behave exactly as before.
 */
export class Migration20260710000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "document_type" add column "requires_item" boolean not null default false;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "document_type" drop column "requires_item";`);
  }
}
