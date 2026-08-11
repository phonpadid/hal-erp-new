import { Account } from '../modules/accounting/accounting.entities';
import { BudgetControlPoint } from '../modules/budget/budget.entities';
import { ToleranceLadder } from '../modules/budget/tolerance-ladder';
import type { ToleranceRung } from '../modules/budget/tolerance-ladder';
import type { Budget } from '../modules/budget/budget.entities';
import type { Company } from '../modules/multi-company/multi-company.entities';
import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * Give a hand-built fixture `Budget` the two things every real budget has: a resolved `account`
 * and a control point that governs it.
 *
 * Fixtures used to create `Budget` rows with only a `gl_account` string. That state is not
 * reachable for an ACTIVE budget through any production path — the migration backfills `account_id`
 * for existing rows and refuses to finish if any ACTIVE budget is left uncovered, and a budget now
 * reaches ACTIVE only through `BudgetPlanService.activate`, which establishes coverage in the same
 * transaction. A budget with neither is not "a simpler budget"; it is a budget that nothing can
 * check, which is precisely the state the coverage invariant exists to make impossible.
 *
 * What this produces is a GRANDFATHERED budget: ACTIVE and covered, with no plan behind it — the
 * shape every row that predates budget plans has. A fixture that wants the new shape should draft
 * one through `BudgetService.create` and activate it through a plan instead.
 *
 * The control point is SELF-SCOPED — the budget's own account and department — so the governed set
 * has exactly one member and every check is arithmetically identical to the per-budget check these
 * specs were written against. That is what lets their assertions stand unchanged.
 *
 * Synchronous and unflushed on purpose, so it composes with the create-many-then-flush-once shape
 * the fixtures already use. Call it after `em.create(Budget, ...)` and before the flush.
 */
export function attachCoverage(
  em: EntityManager,
  company: Company,
  budget: Budget,
  /** The ladder the fixture's control point should carry. Defaults to blocking at the ceiling,
   *  matching what `BudgetService.create` mints when a caller gives none. */
  tolerance: ToleranceRung[] = ToleranceLadder.BLOCK_AT_CEILING,
): void {
  // Reuse the account the fixture already resolved, when it did. Creating a second one would
  // collide on account(company, code) — and would also make the control point key a different node
  // than the budget's own, so it would govern nothing.
  const account =
    budget.account ??
    em.create(Account, {
      company,
      code: budget.glAccount,
      name: `Account ${budget.glAccount}`,
      accountType: 'EXPENSE' as never,
      isPostable: true,
      isActive: true,
    });
  budget.account = account;
  em.create(BudgetControlPoint, {
    company,
    fiscalYear: budget.fiscalYear,
    accountNode: account,
    departmentNode: budget.department,
    capAmount: undefined,
    toleranceJson: ToleranceLadder.stringify(tolerance),
    isActive: true,
  });
}
