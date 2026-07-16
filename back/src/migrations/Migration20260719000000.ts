import { Migration } from '@mikro-orm/migrations';

/**
 * Rename the `CREATE_PO` post-action to `CREATE_SUCCESSOR` and make successor auto-creation a
 * per-pairing choice (invariant 7). Adds `document_type_ref.auto_create`, renames existing
 * `document_type.post_action` values, and backfills `auto_create=true` for the pairings whose
 * predecessor is a `CREATE_SUCCESSOR` type — preserving today's behavior for single-successor
 * types while enabling multi-successor auto-creation. `post_action` is a free-form varchar (no
 * enum/CHECK), so only data changes here besides the new column.
 */
export class Migration20260719000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "document_type_ref" add column "auto_create" boolean not null default false;`,
    );
    // Rename the post-action value first so the backfill can match on the new value.
    this.addSql(
      `update "document_type" set "post_action" = 'CREATE_SUCCESSOR' where "post_action" = 'CREATE_PO';`,
    );
    // Preserve current behavior: pairings whose predecessor auto-created a successor before now
    // carry auto_create=true. Single-successor types are unchanged; multi-successor types now
    // auto-create each such pairing.
    this.addSql(
      `update "document_type_ref" set "auto_create" = true
       where "predecessor_type_id" in (
         select "id" from "document_type" where "post_action" = 'CREATE_SUCCESSOR'
       );`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `update "document_type" set "post_action" = 'CREATE_PO' where "post_action" = 'CREATE_SUCCESSOR';`,
    );
    this.addSql(`alter table "document_type_ref" drop column "auto_create";`);
  }
}
