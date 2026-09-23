import { Migration } from '@mikro-orm/migrations';

/**
 * Stamp the proposer's signature on the documents that were submitted before the stamp existed —
 * but only where the stamp would have been taken had the column been there.
 *
 * `document.submitted_signature_id` (Migration20260915000000) records the signature the submitter
 * had on file at the moment they submitted. Every document submitted before that migration has a
 * null stamp, and its printed proposer column is a ruled line — including documents whose proposer
 * DID have a signature on file that day. For those, the stamp is not invented, it is recovered: the
 * `user_signature` rows are immutable and dated, so "the latest signature this user had uploaded at
 * or before `submitted_at`" is exactly the row the submit would have stamped.
 *
 * A proposer who uploaded their first signature only AFTER submitting is deliberately left null.
 * Stamping a later image would print, as a signature given at submit, one that did not exist then;
 * the column's meaning — locked at the act, like `exchange_rate` — would no longer be true of every
 * row. Those documents keep the ruled line to sign by hand. (On the production copy this stamps
 * 155 of 391 such documents.)
 *
 * Idempotent: only null stamps are touched. `document` is not an append-only ledger, so an UPDATE
 * here is within the rules; `user_signature` and `approval_log` are not written.
 */
export class Migration20260916000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      update "document" d
         set "submitted_signature_id" = (
           select s."id"
             from "user_signature" s
            where s."user_id" = d."created_by"
              and s."uploaded_at" <= d."submitted_at"
            order by s."uploaded_at" desc
            limit 1
         )
       where d."submitted_at" is not null
         and d."submitted_signature_id" is null
         and exists (
           select 1 from "user_signature" s
            where s."user_id" = d."created_by" and s."uploaded_at" <= d."submitted_at"
         );
    `);
  }

  override async down(): Promise<void> {
    // Undo only what this migration could have set: stamps on documents submitted before the stamp
    // column was created. Documents submitted since were stamped by the submit itself and stay.
    this.addSql(`
      update "document" d
         set "submitted_signature_id" = null
       where d."submitted_signature_id" is not null
         and d."submitted_at" < (
           select m."executed_at" from "mikro_orm_migrations" m where m."name" = 'Migration20260915000000'
         );
    `);
  }
}
