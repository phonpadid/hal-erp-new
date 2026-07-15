import { Migration } from '@mikro-orm/migrations';

/**
 * Letterhead contact block for the company (address / phone / email / website), printed in the
 * document PDF's bottom contact footer (Lao official-letter layout). Additive/nullable — no
 * backfill; existing companies export with a footer that degrades line by line.
 */
export class Migration20260715000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "company" add column "address" varchar(255) null;`);
    this.addSql(`alter table "company" add column "phone" varchar(255) null;`);
    this.addSql(`alter table "company" add column "email" varchar(255) null;`);
    this.addSql(`alter table "company" add column "website" varchar(255) null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "company" drop column "address";`);
    this.addSql(`alter table "company" drop column "phone";`);
    this.addSql(`alter table "company" drop column "email";`);
    this.addSql(`alter table "company" drop column "website";`);
  }
}
