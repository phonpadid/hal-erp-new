import { FISCAL_YEAR_CLOSED } from '../multi-company/fiscal-year.service';
import { FiscalYear } from '../multi-company/multi-company.entities';
import { Budget, BudgetNode } from './budget.entities';
import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * A budget found by the code the organisation says out loud — "6.101", not a uuid.
 *
 * Exported as a function rather than added to `BudgetService` because its caller is the item
 * registry, which sits UPSTREAM of budget-control in the build order: master-data may not import
 * this module's providers without inverting that order. A function taking the caller's own
 * `EntityManager` moves no dependency and stays where budget knowledge belongs.
 *
 * The `em` MUST be company-scoped (`CompanyScopeService.forActiveCompany`). That is the whole of
 * invariant 1 here: `fiscal_year` is company-scoped, and a code is only ever looked up inside the
 * year this em can see — so company B's `6.101` is not reachable from company A, and no separate
 * company check is needed on the node or the budget.
 */
export async function findBudgetByPlanCode(em: EntityManager, code: string): Promise<Budget | null> {
  const wanted = code.trim();
  if (!wanted) return null;
  const fiscalYear = await openFiscalYear(em);
  if (!fiscalYear) return null;
  // `budget_node` is unique on (fiscal_year_id, code) and `budget.node_id` is unique, so a code
  // names at most one node and a node at most one budget. No department is involved: the node
  // carries none, deliberately — a control point names a node AND a department node separately.
  const node = await em.findOne(BudgetNode, { fiscalYear: fiscalYear.id, code: wanted });
  if (!node) return null;
  return em.findOne(Budget, { node: node.id, status: 'ACTIVE' });
}

/**
 * The year a plan code is read in: the open one covering today, else the most recent open one.
 *
 * The same rule `BudgetController` defaults `gl-options` to, so a binding can never resolve against
 * a year the picker that set it never offered. Never throws — a company mid-setup, or one that has
 * closed the year in progress, has no open year, and an item's binding simply does not resolve.
 */
async function openFiscalYear(em: EntityManager): Promise<FiscalYear | null> {
  const today = new Date().toISOString().slice(0, 10);
  const covering = await em.findOne(FiscalYear, {
    startDate: { $lte: today },
    endDate: { $gte: today },
    status: { $ne: FISCAL_YEAR_CLOSED },
  });
  return covering ?? em.findOne(FiscalYear, { status: { $ne: FISCAL_YEAR_CLOSED } }, { orderBy: { year: 'DESC' } });
}

/**
 * Every budget of the open year by plan code, for a list that must name many bindings at once.
 *
 * One query for a page of items, rather than {@link findBudgetByPlanCode} per row: the registry
 * reads twenty items at a time and a resolver called twenty times is twenty round trips for a label.
 */
export async function budgetsByPlanCode(em: EntityManager): Promise<Map<string, Budget>> {
  const fiscalYear = await openFiscalYear(em);
  if (!fiscalYear) return new Map();
  const rows = await em.find(
    Budget,
    { status: 'ACTIVE', node: { fiscalYear: fiscalYear.id } },
    { populate: ['node'] },
  );
  return new Map(rows.map((b) => [b.node.code, b]));
}
