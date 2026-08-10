import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';

/** A control point as the reservation path needs it: identity plus the ladder to evaluate. */
export interface GoverningControlPoint {
  id: string;
  fiscalYearId: string;
  accountNodeId: string;
  departmentNodeId: string;
  capAmount: string | null;
  toleranceJson: string;
}

/**
 * Resolves WHICH control points govern a budget.
 *
 * A budget is governed by every active `budget_control_point` in the same company and fiscal year
 * whose `account_node_id` is the budget's own account or an ancestor of it (`account.parent_id`),
 * AND whose `department_node_id` is the budget's own department or an ancestor of it
 * (`department.parent_dept_id`).
 *
 * Every governing point is returned, not just the nearest: a submission must clear all of them.
 * Returning only the most specific would turn "add a narrower control point" into a way to escape
 * a wider ceiling, which is a control defect rather than a convenience.
 */
@Injectable()
export class BudgetCoverageService {
  constructor(private readonly em: EntityManager) {}

  /**
   * Per-request memo of budgetId -> governing control points. Submitting one document resolves the
   * same budget from several places (ancestor-hold check, fold-up, error reporting); the trees are
   * small and change rarely, so resolving once per request is both cheaper and self-consistent —
   * a control point deactivated mid-request cannot make one step of a submit disagree with another.
   *
   * Keyed by EntityManager so a transactional `em` never reads a memo populated outside it.
   */
  private readonly memo = new WeakMap<EntityManager, Map<string, GoverningControlPoint[]>>();

  /**
   * Governing control points for each budget id, keyed by budget id. Budgets with no governing
   * point come back with an empty array — callers MUST treat that as an error, never as
   * "unrestricted" (see BudgetService's coverage enforcement).
   */
  async resolveControlPoints(
    budgetIds: string[],
    em?: EntityManager,
  ): Promise<Map<string, GoverningControlPoint[]>> {
    const out = new Map<string, GoverningControlPoint[]>();
    if (!budgetIds.length) return out;
    const m = em ?? this.em.fork();

    let cache = this.memo.get(m);
    if (!cache) {
      cache = new Map<string, GoverningControlPoint[]>();
      this.memo.set(m, cache);
    }

    const missing = budgetIds.filter((id) => !cache!.has(id));
    if (missing.length) {
      const rows = await this.query(m, missing);
      for (const id of missing) cache.set(id, []);
      for (const r of rows) cache.get(r.budgetId)!.push(r.cp);
    }
    for (const id of budgetIds) out.set(id, cache.get(id) ?? []);
    return out;
  }

  /** Convenience for the single-budget callers (transfer endpoints, budget detail reads). */
  async controlPointsFor(
    budgetId: string,
    em?: EntityManager,
  ): Promise<GoverningControlPoint[]> {
    return (await this.resolveControlPoints([budgetId], em)).get(budgetId) ?? [];
  }

  /** The budget ids a control point governs — the inverse direction, used by balanceAt. */
  async budgetsGovernedBy(controlPointId: string, em?: EntityManager): Promise<string[]> {
    const m = em ?? this.em.fork();
    const rows = await m.getConnection().execute<{ budget_id: string }[]>(
      `
      with recursive account_up as (
        select a.id as node_id, a.id as start_id, a.parent_id
          from account a
        union all
        select p.id, au.start_id, p.parent_id
          from account_up au
          join account p on p.id = au.parent_id
      ),
      dept_up as (
        select d.id as node_id, d.id as start_id, d.parent_dept_id
          from department d
        union all
        select p.id, du.start_id, p.parent_dept_id
          from dept_up du
          join department p on p.id = du.parent_dept_id
      )
      select distinct b.id as budget_id
        from budget_control_point cp
        join account_up au on au.node_id = cp.account_node_id
        join dept_up du on du.node_id = cp.department_node_id
        join budget b
          on b.account_id = au.start_id
         and b.department_id = du.start_id
         and b.fiscal_year_id = cp.fiscal_year_id
       where cp.id = ?
         and cp.is_active = true
      `,
      [controlPointId],
      'all',
      m.getTransactionContext(),
    );
    return rows.map((r) => r.budget_id);
  }

  /**
   * One recursive walk up both trees. `*_up` pairs every node with each of its ancestors AND with
   * itself (the non-recursive term), which is what makes a control point sitting exactly on a
   * budget's own account and department govern it — the shape the seed relies on.
   *
   * Company scoping (invariant 1) comes from `cp.company_id = fy.company_id` joined through the
   * budget's own fiscal year, so a control point can never govern another company's budget even if
   * the two companies' trees happen to share an id.
   */
  private async query(
    em: EntityManager,
    budgetIds: string[],
  ): Promise<{ budgetId: string; cp: GoverningControlPoint }[]> {
    const rows = await em.getConnection().execute<
      {
        budget_id: string;
        id: string;
        fiscal_year_id: string;
        account_node_id: string;
        department_node_id: string;
        cap_amount: string | null;
        tolerance_json: string;
      }[]
    >(
      `
      with recursive account_up as (
        select a.id as node_id, a.id as start_id, a.parent_id
          from account a
        union all
        select p.id, au.start_id, p.parent_id
          from account_up au
          join account p on p.id = au.parent_id
      ),
      dept_up as (
        select d.id as node_id, d.id as start_id, d.parent_dept_id
          from department d
        union all
        select p.id, du.start_id, p.parent_dept_id
          from dept_up du
          join department p on p.id = du.parent_dept_id
      )
      select b.id            as budget_id,
             cp.id,
             cp.fiscal_year_id,
             cp.account_node_id,
             cp.department_node_id,
             cp.cap_amount,
             cp.tolerance_json
        from budget b
        join fiscal_year fy on fy.id = b.fiscal_year_id
        join account_up au on au.start_id = b.account_id
        join dept_up du on du.start_id = b.department_id
        join budget_control_point cp
          on cp.account_node_id = au.node_id
         and cp.department_node_id = du.node_id
         and cp.fiscal_year_id = b.fiscal_year_id
         and cp.company_id = fy.company_id
       where b.id in (${budgetIds.map(() => '?').join(',')})
         and cp.is_active = true
      `,
      budgetIds,
      'all',
      em.getTransactionContext(),
    );
    return rows.map((r) => ({
      budgetId: r.budget_id,
      cp: {
        id: r.id,
        fiscalYearId: r.fiscal_year_id,
        accountNodeId: r.account_node_id,
        departmentNodeId: r.department_node_id,
        capAmount: r.cap_amount,
        toleranceJson: r.tolerance_json,
      },
    }));
  }

  /**
   * Would this control point, if deactivated, leave any ACTIVE budget with nothing governing it?
   * Returns the ids of the budgets that would be stranded (empty = safe to deactivate).
   *
   * An uncovered budget raises no error at spend time — it simply stops being checked — so this
   * has to be answered before the write, not discovered afterwards.
   */
  async budgetsStrandedByDeactivating(
    controlPointId: string,
    em?: EntityManager,
  ): Promise<string[]> {
    const m = em ?? this.em.fork();
    const governed = await this.budgetsGovernedBy(controlPointId, m);
    if (!governed.length) return [];
    // Coverage is read while this point is still active, so a budget it is the ONLY entry for is
    // exactly one whose governing set collapses to this id.
    const coverage = await this.resolveControlPointsUncached(m, governed);
    const stranded = governed.filter((budgetId) =>
      (coverage.get(budgetId) ?? []).every((cp) => cp.id === controlPointId),
    );
    return stranded.length ? this.activeAmong(m, stranded) : [];
  }

  /** Of these budget ids, those whose `status` is ACTIVE — the only ones coverage is owed to. */
  private async activeAmong(em: EntityManager, budgetIds: string[]): Promise<string[]> {
    if (!budgetIds.length) return [];
    const rows = await em.getConnection().execute<{ id: string }[]>(
      `select id from budget where id in (${budgetIds.map(() => '?').join(',')}) and status = 'ACTIVE'`,
      budgetIds,
      'all',
      em.getTransactionContext(),
    );
    return rows.map((r) => r.id);
  }

  /**
   * Coverage read that bypasses the per-request memo. Deactivation asks "what would coverage be",
   * a question the memo's answer to "what is coverage" must not be allowed to satisfy — and must
   * not be allowed to poison either.
   */
  private async resolveControlPointsUncached(
    em: EntityManager,
    budgetIds: string[],
  ): Promise<Map<string, GoverningControlPoint[]>> {
    const out = new Map<string, GoverningControlPoint[]>();
    for (const id of budgetIds) out.set(id, []);
    const rows = await this.query(em, budgetIds);
    for (const r of rows) out.get(r.budgetId)!.push(r.cp);
    return out;
  }
}
