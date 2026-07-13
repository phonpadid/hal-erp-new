import { Migration } from '@mikro-orm/migrations';

/**
 * Add `document_type.default_gl_account` — an optional GL code. On a requires_budget type an
 * item-less line auto-resolves its budget from this GL (+ department + fiscal year), so the
 * requester need not pick a budget. Nullable; existing types behave exactly as before.
 */
export class Migration20260710100000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "document_type" add column "default_gl_account" varchar null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "document_type" drop column "default_gl_account";`);
  }
}
