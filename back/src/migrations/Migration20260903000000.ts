import { Migration } from '@mikro-orm/migrations';

/**
 * A document can say when its money actually moved.
 *
 * `budget_txn.txn_date` has always meant "the day of the event", but the submit path had no way to
 * be told one: it stamped `companyDayFor(documentId, new Date())` — the day of the click. That is
 * correct for a request being raised now and wrong for a year of spending being written down after
 * the fact, which lands entirely in whichever quarter the typing happens in.
 *
 * Two columns, both inert until something sets them:
 *
 *   `document_type.records_past_events` — this type is the form for recording what already
 *     happened. On the TYPE, because "is this our history form?" is configuration; a per-document
 *     choice would let any requester re-date today's disbursement.
 *   `document.money_moved_on` — the day itself, on a document of such a type.
 *
 * Both default to today's behaviour, so applying this alone changes nothing: every existing type
 * reads `false` and every existing document reads `null`.
 *
 * Deliberately hand-written. `migration:create` diffed the entities against the database and
 * proposed dropping every check constraint in the schema, the `(budget_id, txn_date)` index on
 * `budget_txn`, and renaming four unique constraints — drift between hand-written SQL and what the
 * entities declare, none of it this change's business.
 */
export class Migration20260903000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "document_type" add column "records_past_events" boolean not null default false;`,
    );
    this.addSql(`alter table "document" add column "money_moved_on" date null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "document" drop column "money_moved_on";`);
    this.addSql(`alter table "document_type" drop column "records_past_events";`);
  }
}
