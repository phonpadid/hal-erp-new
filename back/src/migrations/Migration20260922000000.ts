import { Migration } from '@mikro-orm/migrations';

/**
 * A document type may say who is allowed to read it.
 *
 * The read scope knows whose department a document belongs to and nothing about what kind of
 * document it is, so every member of a department at DEPARTMENT scope saw that department's budget
 * plans — 106 of them, in the case that raised this — mixed into the list with their own purchase
 * requests. `document_type.view_permission_code` lets a type declare "reading me needs this code":
 * null (the default, and the value every existing type gets) changes nothing; set, a reader without
 * the code does not see the type's documents through their scope. Creators and workflow parties
 * keep access regardless, so gating a type can never strand an approval.
 *
 * A soft code reference into `permission.code`, validated by the service like `category` and
 * `default_gl_account` — not a foreign key, because codes are what the system authorises on.
 *
 * Nothing is backfilled; `down()` drops the column.
 */
export class Migration20260922000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "document_type" add column "view_permission_code" varchar null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "document_type" drop column "view_permission_code";`);
  }
}
