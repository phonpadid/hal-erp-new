import { Migration } from '@mikro-orm/migrations';

/**
 * A document type prints a LIST of sheets, not one.
 *
 * `Migration20260904000000` gave `document_type` a single `print_template`, which was enough until
 * the first real configuration met it: HAL files a purchase request as the official letter AND as
 * the purchase-request form — the letter is what the director signs, the form is what the buyer
 * works from, and both go in the folder. One column holding one value cannot say that.
 *
 * The column becomes `print_templates`, holding the sheets comma-separated in print order. A list
 * that is at most four entries from a closed set does not earn a join table: a child table would
 * cost a query on every export to say what a varchar already says, and every existing value is
 * already a valid one-element list, so the rename carries the data across untouched.
 *
 * The CHECK becomes a pattern over the same closed set rather than a membership test, so a
 * misspelling is still refused at the database, exactly as before.
 *
 * `down()` reverses it by keeping the FIRST sheet of each list — the only single value that can
 * stand for a list, and for every row written before this migration the only value there was.
 */
const TEMPLATES = ['LETTER', 'PR', 'PO', 'RECEIPT'];
const ONE = `(${TEMPLATES.join('|')})`;

export class Migration20260905000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "document_type" drop constraint if exists "document_type_print_template_check";`,
    );
    this.addSql(`alter table "document_type" rename column "print_template" to "print_templates";`);
    this.addSql(
      `alter table "document_type" alter column "print_templates" set default 'LETTER';`,
    );
    this.addSql(
      `alter table "document_type" add constraint "document_type_print_templates_check" ` +
        `check ("print_templates" ~ '^${ONE}(,${ONE})*$');`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "document_type" drop constraint if exists "document_type_print_templates_check";`,
    );
    // Keep the first sheet of each list: the one value that can stand for the whole list.
    this.addSql(
      `update "document_type" set "print_templates" = split_part("print_templates", ',', 1);`,
    );
    this.addSql(`alter table "document_type" rename column "print_templates" to "print_template";`);
    this.addSql(
      `alter table "document_type" add constraint "document_type_print_template_check" ` +
        `check ("print_template" in (${TEMPLATES.map((t) => `'${t}'`).join(', ')}));`,
    );
  }
}
