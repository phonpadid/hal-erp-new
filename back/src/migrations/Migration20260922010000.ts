import { Migration } from '@mikro-orm/migrations';

/**
 * A predecessor has at most one live successor per pairing.
 *
 * A chain reserves budget once, at its reserving ancestor, and settles it once: the first
 * disbursement's approval converts ACTUAL and releases the whole remainder. Nothing stopped a
 * second PO from being raised from the same PR, or a second DISB from the same PO — the second
 * chain then failed at its LAST approval, when settle() found nothing outstanding. This index
 * makes the engine say so at creation instead.
 *
 * Partial: REJECTED and CANCELLED successors have released their holds and ended their claim on
 * the chain, so they free the slot — a PR whose PO was cancelled gets a new one. Every other
 * status, DRAFT included, counts: an auto-created draft is exactly the successor the reservation
 * is waiting on.
 *
 * The pre-check refuses to run over data that already breaks the rule, naming the offenders: the
 * operator cancels the duplicates (which also releases their holds) and re-runs. Skipping the
 * index silently would leave the service check alone, and the race it exists to close, open.
 */
export class Migration20260922010000 extends Migration {
  override async up(): Promise<void> {
    const dupes = await this.execute(`
      select p.doc_no as predecessor, t.code as successor_type,
             string_agg(s.doc_no, ', ' order by s.doc_no) as successors
        from document s
        join document p on p.id = s.ref_document_id
        join document_type t on t.id = s.document_type_id
       where s.ref_document_id is not null
         and s.status not in ('REJECTED', 'CANCELLED')
       group by p.doc_no, t.code
      having count(*) > 1
    `);
    if (dupes.length > 0) {
      const lines = dupes.map(
        (d: { predecessor: string; successor_type: string; successors: string }) =>
          `${d.predecessor} → ${d.successor_type}: ${d.successors}`,
      );
      throw new Error(
        `Cannot create document_live_successor_uq: these predecessors already have more than one ` +
          `live successor of the same type. Cancel the duplicates, then re-run.\n${lines.join('\n')}`,
      );
    }
    this.addSql(
      `create unique index "document_live_successor_uq" on "document" ` +
        `("ref_document_id", "document_type_id") ` +
        `where "ref_document_id" is not null and "status" not in ('REJECTED', 'CANCELLED');`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "document_live_successor_uq";`);
  }
}
