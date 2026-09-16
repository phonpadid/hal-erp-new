import { Migration } from '@mikro-orm/migrations';

/**
 * The proposer signs the request they submit.
 *
 * Every signature the printed sheet carries is a snapshot taken at the moment of the act it stands
 * for: `approval_log.signature_id` at APPROVE, never re-read. The proposer had no such moment — the
 * sheet named them in a typed identity line and left no place for their hand. This column gives
 * submit the same finality approve already has: `document.submitted_signature_id` is the
 * `app_user.current_signature_id` of the person who submitted, stamped once in the submit
 * transaction beside `exchange_rate` and `submitted_at`, and never recomputed (invariant 6).
 *
 * Nullable, deliberately, for two states that are not errors: a submit made by an API key is a
 * system speaking rather than a person signing, and every document submitted before this column
 * existed has no stamp to give. Both print the proposer's name over a ruled line. No backfill —
 * a stamp invented after the fact would claim a signature that was never given.
 *
 * ON DELETE SET NULL mirrors `app_user.current_signature_id`; a `user_signature` row referenced by
 * a submitted document is refused deletion at the service layer anyway, the same way one referenced
 * by an approval is.
 */
export class Migration20260915000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "document" add column "submitted_signature_id" uuid null;`);
    this.addSql(
      `alter table "document" add constraint "document_submitted_signature_id_foreign" foreign key ("submitted_signature_id") references "user_signature" ("id") on update cascade on delete set null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "document" drop constraint if exists "document_submitted_signature_id_foreign";`);
    this.addSql(`alter table "document" drop column "submitted_signature_id";`);
  }
}
