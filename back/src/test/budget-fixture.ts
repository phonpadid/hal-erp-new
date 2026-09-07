import { Account } from '../modules/accounting/accounting.entities';
import { AccountType } from '../common/enums';
import { Budget, BudgetControlPoint, BudgetNode } from '../modules/budget/budget.entities';
import { ToleranceLadder } from '../modules/budget/tolerance-ladder';
import type { ToleranceRung } from '../modules/budget/tolerance-ladder';
import type { Company, Department, FiscalYear } from '../modules/multi-company/multi-company.entities';
import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * Give a hand-built fixture `Budget` the control point that governs it. Its other half — the
 * resolved `account` a document needs to charge it — is {@link budgetAt}'s.
 *
 * Fixtures used to create `Budget` rows with neither. A budget nothing governs is not "a simpler
 * budget"; it is a budget with no row to lock and no ceiling to check, which is precisely the state
 * the coverage invariant exists to make impossible. A budget reaches ACTIVE only through
 * `BudgetPlanService.activate`, which establishes coverage in the same transaction.
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
  const { code, withoutAccount, ...rest } = data as typeof data & { withoutAccount?: boolean };
  const node = em.create(BudgetNode, { fiscalYear: data.fiscalYear, code });
  const budget = em.create(Budget, { ...rest, node } as never);
  // Many fixtures pass `em.getReference(FiscalYear, id)`, whose `company` is not loaded. Fall back
  // to the department, and when neither can name a company, mint nothing rather than throw: those
  // call sites are reading budgets, not submitting documents against them, and a fixture helper has
  // no business failing a spec that never asked for an account.
  const company = companyOf(data.fiscalYear) ?? companyOf(data.department);
  if (!withoutAccount && !budget.account && company) {
    budget.account = postableAccountFor(em, company, (rest.glAccount as string) || code);
  }
  return budget;
}

/**
 * The chart-of-accounts row a fixture budget's `account_id` points at.
 *
 * Every budget a document may charge has one: submit refuses a line whose budget names no account,
 * because `Posting on Payment Settlement` debits the expense side via `budget.account_id` and a
 * budget without one strands the payment at the ledger. A fixture that omitted it was not building
 * a simpler budget — it was building one that nothing can submit against, which is a state under
 * test in exactly two specs and an accident everywhere else. Those two pass `withoutAccount: true`.
 *
 * Deduplicated against what is already pending, because `account` is unique on `(company, code)`
 * and fixtures legitimately point several budgets at one account — a company's own accounts, and an
 * INACTIVE budget sharing the code of an ACTIVE one. Reads the persist stack rather than querying:
 * this runs before the flush, so the row it must not duplicate is not in the database yet.
 */
/** The company on a fixture's fiscal year or department, when that side was actually loaded. */
function companyOf(owner: { company?: Company } | undefined): Company | undefined {
  const company = owner?.company;
  return company && (company as { id?: string }).id ? company : undefined;
}

function postableAccountFor(em: EntityManager, company: Company, code: string): Account {
  const pending = em
    .getUnitOfWork()
    .getPersistStack()
    .values() as IterableIterator<object>;
  for (const e of pending) {
    if (e instanceof Account && e.code === code && e.company?.id === company.id) return e;
  }
  return em.create(Account, {
    company,
    code,
    name: `Account ${code}`,
    accountType: AccountType.EXPENSE,
    isPostable: true,
    isActive: true,
  });
}
