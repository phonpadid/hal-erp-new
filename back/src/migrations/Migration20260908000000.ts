import { Migration } from '@mikro-orm/migrations';

/**
 * `budget.status` may only hold a status the application declares.
 *
 * The column was created `varchar(255) not null default 'ACTIVE'` with no CHECK, mapped to a plain
 * `string`, and `UpdateBudgetDto.status` validated as `@IsString() @MaxLength(50)`. Anything at all
 * was storable, and something was: `INACTIVE` reached a live column and the budget edit form while
 * appearing in no declared list — `BUDGET_STATUSES` never contained it. It is declared now, and so
 * are the four that always were.
 *
 * This constraint is the BACKSTOP, not the guard. `BudgetService.update` is what refuses an
 * unsanctioned MOVE with a sentence naming both statuses; a CHECK cannot see the row's previous
 * value and would answer a typo with a driver error. What the constraint gives is that an
 * undeclared status is unrepresentable no matter which writer is at fault, including one written
 * after this.
 *
 * No backfill. The five declared values cover every row: the database holds 230 `ACTIVE`,
 * 5 `REJECTED` and 1 `DRAFT`, and the constraint is added `NOT VALID`-free precisely because there
 * is nothing to exclude.
 */
export class Migration20260908000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "budget" add constraint "budget_status_check" check ` +
        `("status" in ('DRAFT', 'ACTIVE', 'INACTIVE', 'REJECTED', 'CLOSED'));`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "budget" drop constraint "budget_status_check";`);
  }
}
