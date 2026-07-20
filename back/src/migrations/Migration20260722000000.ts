import { Migration } from '@mikro-orm/migrations';

/**
 * Drop the redundant `api_key_prefix_index`.
 *
 * `Migration20260720000000` created both a unique constraint on `api_key.prefix` and a separate
 * non-unique index over the same single column. PostgreSQL already backs `api_key_prefix_unique`
 * with a btree index, and that is what the per-request prefix lookup on the authentication path
 * uses — so the extra index can serve no query the unique's index cannot, while still costing a
 * write on every insert and disk to store. The DBML has been corrected to match.
 *
 * Corrected forward rather than by editing `Migration20260720000000`, which is already applied to
 * developer databases; editing it in place would leave those databases with the index still
 * present and nothing pending to remove it.
 */
export class Migration20260722000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`drop index if exists "api_key_prefix_index";`);
  }

  override async down(): Promise<void> {
    this.addSql(`create index "api_key_prefix_index" on "api_key" ("prefix");`);
  }
}
