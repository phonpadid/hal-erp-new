import { Migration } from '@mikro-orm/migrations';

/**
 * The system now names a document's attachments itself — `<doc_no>-<nn><ext>` — so a page that
 * falls out of a printed set can be tied back to its document, and a Lao filename no longer has to
 * carry that job. What the uploader called the file is not thrown away: it moves to this column,
 * decoded as UTF-8, for people to recognise the file they chose. Null for every row filed before
 * names were generated; those keep the `file_name` they were filed under.
 */
export class Migration20260917000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "document_attachment" add column "original_file_name" varchar(255) null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "document_attachment" drop column "original_file_name";`);
  }
}
