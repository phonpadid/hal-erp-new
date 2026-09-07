import { Migration } from '@mikro-orm/migrations';

/**
 * `document_type.print_template` — which pre-printed sheet a type produces when it is exported.
 *
 * The exporter has only ever rendered one layout, the Lao official letter (ໃບສະເໜີ), while the
 * business files three other forms on paper: ໃບສະເໜີຈັດຊື້ (PR), ໃບສັ່ງຊື້ (PO) and ໃບເບີກຈ່າຍ
 * (RECEIPT). Which one a document prints is configuration, not a branch on `code` (invariant 7):
 * one company spells its purchase request `PR` and another `REQ`, and a company may run several
 * purchase-request types at once.
 *
 * The column is NOT NULL with a `LETTER` default rather than nullable, because every document
 * prints as *something* — a null would be a second spelling of `LETTER`, the same ambiguity
 * `Migration20260831000000` had to clean out of `post_action` when `'NONE'` and null both meant
 * "does nothing". Existing rows take the default, so every type keeps printing exactly what it
 * printed before this migration; a company opts a type into a business form through the admin
 * screen, as data.
 *
 * `down()` drops the constraint and the column together. Nothing else reads it, and a dropped
 * column cannot leave the value behind, so the rollback is total rather than partial.
 */
const PRINT_TEMPLATES = ['LETTER', 'PR', 'PO', 'RECEIPT'];

export class Migration20260904000000 extends Migration {
  override async up(): Promise<void> {
    // Added WITH the default in one statement, so existing rows are written as LETTER by the same
    // statement that forbids null — there is no window where the column exists and is unconstrained.
    this.addSql(
      `alter table "document_type" add column "print_template" varchar(255) not null default 'LETTER';`,
    );

    const values = PRINT_TEMPLATES.map((t) => `'${t}'`).join(', ');
    this.addSql(
      `alter table "document_type" drop constraint if exists "document_type_print_template_check";`,
    );
    this.addSql(
      `alter table "document_type" add constraint "document_type_print_template_check" ` +
        `check ("print_template" in (${values}));`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "document_type" drop constraint if exists "document_type_print_template_check";`,
    );
    this.addSql(`alter table "document_type" drop column if exists "print_template";`);
  }
}
