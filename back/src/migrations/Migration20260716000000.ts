import { Migration } from '@mikro-orm/migrations';

/**
 * Create `document_type_ref` — allowed predecessor→successor document-type pairings for the
 * reference chain (create-from + CREATE_PO). Replaces the hardcoded REF_CHAIN object so chains
 * are configuration, per company (invariant 7). Company-scoped (invariant 1): both pairing
 * endpoints must be document_types of the same company; unique per
 * (company_id, predecessor_type_id, successor_type_id).
 *
 * The `up` also back-fills the four previously-hardcoded pairings for every company that owns
 * both types: PR→PO, PROC→PO, PO→DISB, ADVANCE→CLEAR_ADVANCE.
 */
export class Migration20260716000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "document_type_ref" (
      "id" uuid not null,
      "company_id" uuid not null,
      "predecessor_type_id" uuid not null,
      "successor_type_id" uuid not null,
      constraint "document_type_ref_pkey" primary key ("id")
    );`);

    this.addSql(
      `alter table "document_type_ref" add constraint "document_type_ref_company_id_predecessor_type_id_successor_type_id_unique" unique ("company_id", "predecessor_type_id", "successor_type_id");`,
    );
    this.addSql(
      `create index "document_type_ref_company_id_predecessor_type_id_index" on "document_type_ref" ("company_id", "predecessor_type_id");`,
    );

    this.addSql(
      `alter table "document_type_ref" add constraint "document_type_ref_company_id_foreign" foreign key ("company_id") references "company" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "document_type_ref" add constraint "document_type_ref_predecessor_type_id_foreign" foreign key ("predecessor_type_id") references "document_type" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "document_type_ref" add constraint "document_type_ref_successor_type_id_foreign" foreign key ("successor_type_id") references "document_type" ("id") on update cascade;`,
    );

    // Back-fill the previously-hardcoded REF_CHAIN pairings for every company that owns both
    // types. Resolves each side by (company_id, code); companies missing a type get no row for
    // that pairing (identical to the old no-op behavior). Idempotent via the unique constraint.
    // Codes are fixed literals we control (no user input), so inlining is safe here.
    for (const [predecessor, successor] of [
      ['PR', 'PO'],
      ['PROC', 'PO'],
      ['PO', 'DISB'],
      ['ADVANCE', 'CLEAR_ADVANCE'],
    ]) {
      this.addSql(
        `insert into "document_type_ref" ("id", "company_id", "predecessor_type_id", "successor_type_id")
         select gen_random_uuid(), p."company_id", p."id", s."id"
         from "document_type" p
         join "document_type" s on s."company_id" = p."company_id" and s."code" = '${successor}'
         where p."code" = '${predecessor}'
         on conflict ("company_id", "predecessor_type_id", "successor_type_id") do nothing;`,
      );
    }
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "document_type_ref" cascade;`);
  }
}
