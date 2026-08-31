import { Migration } from '@mikro-orm/migrations';

/**
 * A place in the plan can say that the money beneath it belongs to the whole company.
 *
 * The budget picker offered a requester their own department's budgets and nothing else, which is
 * wrong for most of the customer's plan. `1.100 ຄ່າບໍລິຫານ ທົວໄປ` and `1.400 ລາຍຈ່າຍປະຈຳເດືອນ` hold
 * the office supplies, the security guards, the phone bills and the cleaning contract that every
 * department consumes — held by `ບໍລິຫານ`, spent by everyone. Nothing in the data said so, because
 * the workbook that states the plan has no column for it.
 *
 * On `budget_node` and inherited by the subtree, so marking those two nodes covers every line
 * beneath them, including lines added later.
 *
 * `budget.department_id` is untouched: the mark says who may CHARGE the money, not who owns it.
 *
 * Defaults to false, so applying this alone changes nothing — every existing node reads as not
 * shared. Deliberately not backfilled: which nodes are shared is the customer's statement to make,
 * and a guess here would be indistinguishable from their answer.
 *
 * Hand-written for the same reason as `Migration20260903000000`: `migration:create` diffs the
 * entities against the database and proposes dropping check constraints and indexes that are drift
 * between hand-written SQL and the entities, none of it this change's business.
 */
export class Migration20260904000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "budget_node" add column "is_shared" boolean not null default false;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "budget_node" drop column "is_shared";`);
  }
}
