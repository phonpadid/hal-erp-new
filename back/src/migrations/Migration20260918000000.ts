import { Migration } from '@mikro-orm/migrations';

/**
 * The abbreviations a company stamps in a paper document number (`1034/ຈຊຈ/ບຫ`): one on the
 * document type, one on the department. Both optional and not unique; a renderer that has none
 * falls back to the code, so nothing is backfilled and nothing changes until an administrator
 * enters them.
 */
export class Migration20260918000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "document_type" add column "short_name" varchar(255) null;');
    this.addSql('alter table "department" add column "short_name" varchar(255) null;');
  }

  override async down(): Promise<void> {
    this.addSql('alter table "document_type" drop column "short_name";');
    this.addSql('alter table "department" drop column "short_name";');
  }
}
