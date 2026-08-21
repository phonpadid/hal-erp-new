import { Account } from '../modules/accounting/accounting.entities';
import { Budget, BudgetControlPoint, BudgetNode } from '../modules/budget/budget.entities';
import { ToleranceLadder } from '../modules/budget/tolerance-ladder';
import type { ToleranceRung } from '../modules/budget/tolerance-ladder';
import type { Company, Department, FiscalYear } from '../modules/multi-company/multi-company.entities';
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
  // The control point sits on the budget's own NODE, which is the whole node it needs to govern.
  // It used to have to mint an account to hang on — the coverage query walked the account tree —
  // and that account had to be the budget's own or the point would govern nothing. Coverage walks
  // the node tree now, so the fixture has no reason to touch the chart of accounts at all.
  em.create(BudgetControlPoint, {
    company,
    fiscalYear: budget.fiscalYear,
    budgetNode: budget.node,
    departmentNode: budget.department,
    capAmount: undefined,
    toleranceJson: ToleranceLadder.stringify(tolerance),
    isActive: true,
  });
}

/**
 * A budget together with the node its money sits at.
 *
 * Fixtures used to build a budget from `(fiscalYear, department, glAccount)` because that WAS its
 * identity. It is the node now, and every fixture would otherwise have to mint one by hand next to
 * every budget it creates. Takes the same `code` those fixtures already pass and puts it where it
 * belongs — the shape of each call site is unchanged, which is what keeps their assertions
 * meaningful across the move.
 *
 * Synchronous and unflushed, like {@link attachCoverage}, so it composes with the
 * create-many-then-flush-once shape the fixtures use.
 */
export function budgetAt(
  em: EntityManager,
  data: { fiscalYear: FiscalYear; department: Department; code: string } & Record<string, unknown>,
): Budget {
  const { code, ...rest } = data;
  const node = em.create(BudgetNode, { fiscalYear: data.fiscalYear, code });
  return em.create(Budget, { ...rest, node } as never);
}
