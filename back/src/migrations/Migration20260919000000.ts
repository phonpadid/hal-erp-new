import { Migration } from '@mikro-orm/migrations';

/**
 * Matching and receiving become document-type configuration.
 *
 * Three-way matching was hardcoded: every CUT_BUDGET document with a predecessor was held against
 * that predecessor's received quantities and amounts. Written for DISB → PO, it also caught a
 * company whose chain ends at the PO — the PO was matched against a PR that had bought nothing —
 * and it made services "receive" what cannot arrive. `match_mode` says per type: THREE_WAY (the
 * old behaviour, and the default every existing type gets), TWO_WAY (amount only), or NONE.
 *
 * `receives_goods` says which types take receipts at all. The action was offered on every approved
 * document with lines, so receipts landed on requisitions while matching went on reading the PO.
 * Backfilled once from what received in practice — a type that is the predecessor of a pairing
 * whose successor settles budget — so nothing that receives today stops; then it is configuration.
 *
 * `down()` drops both columns; nothing else to undo.
 */
export class Migration20260919000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "document_type" add column "match_mode" varchar(255) not null default 'THREE_WAY', ` +
        `add column "receives_goods" boolean not null default false;`,
    );
    this.addSql(
      `alter table "document_type" add constraint "document_type_match_mode_check" ` +
        `check (match_mode in ('NONE', 'TWO_WAY', 'THREE_WAY'));`,
    );
    this.addSql(`
      update "document_type" p set "receives_goods" = true
       where exists (
         select 1 from "document_type_ref" r
         join "document_type" s on s.id = r.successor_type_id
        where r.predecessor_type_id = p.id and s.post_action = 'CUT_BUDGET'
       );
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "document_type" drop constraint if exists "document_type_match_mode_check";`);
    this.addSql(`alter table "document_type" drop column "match_mode", drop column "receives_goods";`);
  }
}
