import { Migration } from '@mikro-orm/migrations';

/**
 * A letter is addressed to whoever its document type names.
 *
 * Every letter this system prints greets `ຜູ້ອຳນວຍການ` + the company name, because that phrase was
 * built in the renderer with only the company interpolated. That is wrong for a type whose request
 * goes to a department rather than to the managing director, and it could not be fixed by
 * configuration.
 *
 * `letter_addressee` replaces the whole phrase, in the salutation and in the closing paragraph
 * alike. Nullable with no default and no backfill, deliberately: NULL is "address the director",
 * which is what every existing type means and what every existing type keeps. Nothing to recompute,
 * nothing that can fail on existing rows, and no document that prints correctly today changes.
 *
 * It does not touch the company-name letterhead — that names the issuer, not the recipient.
 */
export class Migration20261006000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "document_type" add column "letter_addressee" varchar(255) null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "document_type" drop column if exists "letter_addressee";`);
  }
}
