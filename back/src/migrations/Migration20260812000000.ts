import { Migration } from '@mikro-orm/migrations';

/**
 * Make the budget dimension key status-aware, so a proposed budget can hold its slot and a
 * rejected one can give it back.
 *
 * `budget` becomes a three-state row: DRAFT while a budget plan proposes it, ACTIVE once that plan
 * is approved, REJECTED if it is turned down. The unconditional unique constraint cannot express
 * that. A DRAFT row occupying its (fiscal_year, department, gl_account) slot is WANTED — it is
 * what stops two plans proposing the same line concurrently, enforced by the database rather than
 * by a check-then-insert race. A REJECTED row occupying it forever is not: that line could never
 * be budgeted again for that fiscal year.
 *
 * Existing data is unaffected. Every row today is ACTIVE, so at this moment the partial index and
 * the constraint it replaces accept exactly the same set of rows.
 */
export class Migration20260812000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "budget" drop constraint if exists "budget_fiscal_year_id_department_id_gl_account_unique";`,
    );
    this.addSql(
      `create unique index "budget_dimension_unique_unless_rejected" on "budget" ` +
        `("fiscal_year_id", "department_id", "gl_account") where "status" <> 'REJECTED';`,
    );
  }

  override async down(): Promise<void> {
    // This fails with a duplicate-key error if any REJECTED budget shares its three dimensions with
    // a live one — which is exactly the state the partial index exists to allow, so it becomes
    // likely the moment plans start being rejected. Said here because Postgres will only report the
    // constraint name, which explains nothing about why the rows are legitimate.
    this.addSql(
      `drop index if exists "budget_dimension_unique_unless_rejected";`,
    );
    this.addSql(
      `alter table "budget" add constraint "budget_fiscal_year_id_department_id_gl_account_unique" ` +
        `unique ("fiscal_year_id", "department_id", "gl_account");`,
    );
  }
}
