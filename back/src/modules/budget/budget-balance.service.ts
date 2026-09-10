import { EntityManager, QueryOrder } from '@mikro-orm/postgresql';
import { Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { BudgetTxnType } from '../../common/enums';
import { budgetTxnDirection, isCountedBudget } from '@erp/shared';
import { Money } from '../../common/money/money';
import { pageParams, type Paginated } from '../../common/pagination/pagination';
import { Document } from '../document/document.entities';
import {Budget, BudgetTxn} from './budget.entities';

const FILTER_OFF = { filters: { company: false } } as const;

/**
 * The `txn_date` bound for an as-of read, or nothing when the caller asked for none.
 *
 * `<=` on a day, so "as of 30 June" includes everything that happened on 30 June — the reading a
 * person means when they say it. Omitting `asOf` leaves the fold unbounded, which is what every
 * existing caller wants and keeps their meaning unchanged.
 *
 * Deliberately NOT offered on the availability check: a reservation is made now, and evaluating
 * whether a budget can afford one as of a past date would be a way to spend money that has since
 * been committed. The parameter belongs on the reads, not on the gate.
 */
function asOfBound(asOf?: string): Record<string, unknown> {
  return asOf ? { txnDate: { $lte: asOf } } : {};
}

export interface BalanceBreakdown {
  amountTotal: string;
  adjustIncrease: string;
  adjustDecrease: string;
  transferIn: string;
  transferOut: string;
  reserved: string;
  actual: string;
  released: string;
  available: string;
}

export interface LedgerEntry {
  id: string;
  txnType: BudgetTxnType;
  amount: string;
  documentId: string | null;
  documentNo: string | null;
  remark: string | null;
  /** The day the event happened, in the company's own timezone. */
  txnDate: string;
  /** When the system learned of the row — not the same question as `txnDate`. */
  createdAt: Date | null;
}

/**
 * Derived budget balances (invariant 3). Balance is ALWAYS summed from budget_txn;
 * budget.amount_total is never mutated to reflect usage.
 */
@Injectable()
export class BudgetBalanceService {
  constructor(private readonly em: EntityManager) {}

  /**
   * available = amount_total + ADJUST_INCREASE − ADJUST_DECREASE + TRANSFER_IN
   *             − TRANSFER_OUT − RESERVE + RELEASE  (company base currency)
   *
   * ACTUAL is deliberately NOT a deduction. It converts money that RESERVE already took out
   * of the budget into money actually spent — `settle` posts ACTUAL for the consumed amount
   * and RELEASE only the unused remainder (outstanding = Σ RESERVE − Σ RELEASE − Σ ACTUAL),
   * so the reserve that was never released *is* the spend. Subtracting ACTUAL as well would
   * charge the budget twice for the same document.
   *
   * Pass the transactional `em` when computing inside a reservation/transfer.
   */
  async availableBalance(budgetId: string, em?: EntityManager, asOf?: string): Promise<string> {
    // Fork when not invoked inside a caller's transaction (controller path), so we never
    // touch the global EntityManager outside a request context.
    const m = em ?? this.em.fork();
    // Budget isn't company-scoped, but it relates to scoped fiscalYear/department;
    // disable the company filter so these ledger reads don't demand its params.
    const budget = await m.findOne(Budget, { id: budgetId }, { filters: { company: false } });
    if (!budget) throw new NotFoundException(`Budget ${budgetId} not found`);
    const txns = await m.find(BudgetTxn, { budget: budgetId, ...asOfBound(asOf) }, { filters: { company: false } });

    let balance = budget.amountTotal;
    for (const t of txns) {
      balance = this.applyToBalance(balance, t.txnType, t.amount);
    }
    return balance;
  }

  /**
   * Batched available balance for many budgets in TWO queries (budgets + their txns), keyed by
   * budget id — so a list view resolves every row's available in one round-trip instead of one
   * `breakdown`/`balance` call per row (the old N+1). Same formula as availableBalance; ACTUAL is
   * not a deduction. Scoped to the active company via fiscalYear.company (invariant 1): ids that
   * don't belong to the active company are silently omitted from the result.
   */
  async availableFor(budgetIds: string[], em?: EntityManager): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!budgetIds.length) return out;
    const m = em ?? this.em.fork();
    const companyId = RequestContext.companyId();
    const where = companyId
      ? { id: { $in: budgetIds }, fiscalYear: { company: companyId } }
      : { id: { $in: budgetIds } };
    const budgets = await m.find(Budget, where, FILTER_OFF);
    if (!budgets.length) return out;
    for (const b of budgets) out.set(b.id, b.amountTotal);
    const txns = await m.find(BudgetTxn, { budget: { $in: budgets.map((b) => b.id) } }, FILTER_OFF);
    for (const t of txns) {
      // t.budget is an unpopulated reference here; .id reads the FK without a DB hit.
      const bid = t.budget.id;
      const bal = out.get(bid);
      if (bal === undefined) continue;
      out.set(bid, this.applyToBalance(bal, t.txnType, t.amount));
    }
    return out;
  }

  /**
   * Apply one ledger entry to a running balance, in the direction the shared classification gives
   * it. `CONVERTS` (a settlement) leaves the balance alone: the money left when the RESERVE was
   * taken, and counting it again charges the budget twice (invariant 3).
   *
   * The direction is read from `shared` rather than restated here. It used to be spelled out in
   * four switches in this file and once more in the ledger screen; four agreed and the fifth drew
   * a settlement as a withdrawal, which is the ordinary fate of a fact kept in five places.
   */
  private applyToBalance(balance: string, txnType: string, amount: string): string {
    switch (budgetTxnDirection(txnType)) {
      case 'ADDS':
        return Money.add(balance, amount);
      case 'SUBTRACTS':
        return Money.subtract(balance, amount);
      case 'CONVERTS':
        return balance;
    }
  }

  /**
   * The same classification applied to a running CONSUMPTION rather than a balance — `used` is the
   * balance's mirror, so what adds to one subtracts from the other. `CONVERTS` is unchanged by the
   * flip: a settlement moves nothing either way.
   */
  private applyToUsed(used: string, txnType: string, amount: string): string {
    switch (budgetTxnDirection(txnType)) {
      case 'ADDS':
        return Money.subtract(used, amount);
      case 'SUBTRACTS':
        return Money.add(used, amount);
      case 'CONVERTS':
        return used;
    }
  }

  /**
   * The derived balance broken into its components — all summed from budget_txn, in the
   * company base currency. available reuses the availableBalance formula so they never
   * diverge. Scoped to the active company via the budget's fiscal year.
   */
  async breakdown(budgetId: string, em?: EntityManager, asOf?: string): Promise<BalanceBreakdown> {
    const m = em ?? this.em.fork();
    const budget = await this.requireInActiveCompany(budgetId, m);
    const txns = await m.find(BudgetTxn, { budget: budgetId, ...asOfBound(asOf) }, FILTER_OFF);

    const sum: Record<BudgetTxnType, string> = {
      [BudgetTxnType.ADJUST_INCREASE]: '0',
      [BudgetTxnType.ADJUST_DECREASE]: '0',
      [BudgetTxnType.TRANSFER_IN]: '0',
      [BudgetTxnType.TRANSFER_OUT]: '0',
      [BudgetTxnType.RESERVE]: '0',
      [BudgetTxnType.ACTUAL]: '0',
      [BudgetTxnType.RELEASE]: '0',
    };
    for (const t of txns) sum[t.txnType] = Money.add(sum[t.txnType], t.amount);

    let available = budget.amountTotal;
    available = Money.add(available, sum[BudgetTxnType.ADJUST_INCREASE]);
    available = Money.subtract(available, sum[BudgetTxnType.ADJUST_DECREASE]);
    available = Money.add(available, sum[BudgetTxnType.TRANSFER_IN]);
    available = Money.subtract(available, sum[BudgetTxnType.TRANSFER_OUT]);
    available = Money.subtract(available, sum[BudgetTxnType.RESERVE]);
    available = Money.add(available, sum[BudgetTxnType.RELEASE]);
    // ACTUAL is reported below but is NOT subtracted: it consumes the reserve, which already
    // reduced the balance. See availableBalance() — the two must never diverge.

    return {
      amountTotal: budget.amountTotal,
      adjustIncrease: sum[BudgetTxnType.ADJUST_INCREASE],
      adjustDecrease: sum[BudgetTxnType.ADJUST_DECREASE],
      transferIn: sum[BudgetTxnType.TRANSFER_IN],
      transferOut: sum[BudgetTxnType.TRANSFER_OUT],
      reserved: sum[BudgetTxnType.RESERVE],
      actual: sum[BudgetTxnType.ACTUAL],
      released: sum[BudgetTxnType.RELEASE],
      available,
    };
  }

  /**
   * Available at a CONTROL POINT — the widened form of availableBalance, and the only place the
   * set of rows summed differs from the per-budget reads above.
   *
   * Same formula, same terms, same ACTUAL rule (invariant 3); only the scope widens, from one
   * budget to every budget the control point governs. The ceiling is `cap_amount` when set and the
   * rollup of the governed budgets' `amount_total` when it is NULL — which is the only supported
   * form today, `cap_amount` being rejected on write until a parent/child reconciliation rule
   * exists.
   *
   * ── PROJECTION SEAM ──────────────────────────────────────────────────────────────────────────
   * This live sum is the ONLY thing a `budget_balance` projection would replace. Because the
   * control point row is already the lock target, swapping the body of this method for a single
   * keyed read changes no caller, no lock, and no test. Build the projection when any of these is
   * true — not before, since at ~30 budget transactions/day none of them is close:
   *   · p95 of a budget-bearing submit exceeds ~300ms
   *   · the largest governed set exceeds ~500 budgets
   *   · budget_txn exceeds ~500k rows
   *   · a bulk historical import lands
   * See design.md D5 for the projection's shape and the rules it must carry.
   */
  async balanceAt(
    governedBudgetIds: string[],
    capAmount: string | null,
    em?: EntityManager,
  ): Promise<{ ceiling: string; used: string; available: string }> {
    const m = em ?? this.em.fork();
    if (!governedBudgetIds.length) {
      // A control point governing no budget is a ZERO ceiling, never an unlimited one.
      //
      // This mattered less when a point had to name an account that budgets already hung from.
      // A point may now sit on an empty category — a plan being built has them, and that is not a
      // fault — so this path is reachable in normal use rather than only through misconfiguration.
      // Falling through to "no budgets, no limit" would turn every unfinished category into a hole
      // nothing could exceed, and it would raise nothing while doing it.
      return { ceiling: '0', used: '0', available: '0' };
    }
    const budgets = await m.find(Budget, { id: { $in: governedBudgetIds } }, FILTER_OFF);
    // The ceiling sums the APPROPRIATIONS the governed budgets hold. A category is a `budget_node`
    // and holds no amount, so a subtree's money appears here exactly once, through the budgets that
    // hold it — and a budget that is not money contributes nothing.
    //
    // This summed every row regardless of status until `a-refused-budget-grants-no-ceiling`, and a
    // REJECTED budget of 23,056,000 was observed granting exactly that much room to a sibling whose
    // own appropriation was zero, under a ladder blocking at 100 percent that was working as
    // written. A refused proposal is not an appropriation.
    let rollup = '0';
    for (const b of budgets) {
      if (isCountedBudget(b.status)) rollup = Money.add(rollup, b.amountTotal);
    }
    const ceiling = capAmount ?? rollup;

    const txns = await m.find(
      BudgetTxn,
      { budget: { $in: budgets.map((b) => b.id) } },
      FILTER_OFF,
    );
    // `used` is what the ceiling has been drawn down by, expressed so that
    // available = ceiling − used holds for both the rollup and the cap_amount case.
    //
    // Over EVERY governed budget, counted or not — deliberately asymmetric with the rollup above,
    // and the asymmetry is the point. A budget that leaves ACTIVE while holding an outstanding
    // RESERVE has not released it; nothing wrote a RELEASE. Skipping its rows here would hand the
    // group back money it is still holding, and would make available depend on the order in which
    // somebody flips a status.
    let used = '0';
    for (const t of txns) {
      used = this.applyToUsed(used, t.txnType, t.amount);
    }
    return { ceiling, used, available: Money.subtract(ceiling, used) };
  }

  /**
   * `balanceAt` for MANY control points in TWO queries — the budgets any of them govern, and those
   * budgets' transactions — then folded per group in memory.
   *
   * A list of control points would otherwise cost two queries per row. Groups overlap freely: a
   * budget governed by several points is counted once in each, which is what makes each group's
   * available mean "what this ceiling has left", independently of the others.
   *
   * The arithmetic is the single-point formula, term for term. `balanceAtMany` and `balanceAt` must
   * never disagree; the spec pins that with a test comparing them on the same set.
   */
  async balanceAtMany(
    groups: Map<string, { budgetIds: string[]; capAmount: string | null }>,
    em?: EntityManager,
  ): Promise<Map<string, { ceiling: string; used: string; available: string }>> {
    const out = new Map<string, { ceiling: string; used: string; available: string }>();
    if (!groups.size) return out;
    const m = em ?? this.em.fork();

    const allIds = [...new Set([...groups.values()].flatMap((g) => g.budgetIds))];
    const amountById = new Map<string, string>();
    const usedById = new Map<string, string>();
    if (allIds.length) {
      const budgets = await m.find(Budget, { id: { $in: allIds } }, FILTER_OFF);
      for (const b of budgets) {
        // Only an appropriation raises a ceiling (see `balanceAt`); every governed budget's ledger
        // rows still count against it, which is why `usedById` is seeded for all of them and
        // `amountById` only for the counted ones. The two maps are folded independently below.
        if (isCountedBudget(b.status)) amountById.set(b.id, b.amountTotal);
        usedById.set(b.id, '0');
      }
      // Keyed off `usedById`, which holds EVERY governed budget — `amountById` now holds only the
      // counted ones, and reading the ids from there would silently drop an INACTIVE budget's
      // outstanding reservations from the group.
      const txns = await m.find(BudgetTxn, { budget: { $in: [...usedById.keys()] } }, FILTER_OFF);
      for (const t of txns) {
        const bid = t.budget.id;
        const cur = usedById.get(bid);
        if (cur === undefined) continue;
        usedById.set(bid, this.applyToUsed(cur, t.txnType, t.amount));
      }
    }

    for (const [key, group] of groups) {
      let rollup = '0';
      let used = '0';
      for (const id of group.budgetIds) {
        rollup = Money.add(rollup, amountById.get(id) ?? '0');
        used = Money.add(used, usedById.get(id) ?? '0');
      }
      const ceiling = group.capAmount ?? rollup;
      out.set(key, { ceiling, used, available: Money.subtract(ceiling, used) });
    }
    return out;
  }

  /**
   * The control-point balance broken into the same components as `breakdown`, reusing balanceAt
   * for `available` so the two can never diverge — the same coupling availableBalance and
   * breakdown already have for a single budget.
   */
  async breakdownAt(
    governedBudgetIds: string[],
    capAmount: string | null,
    em?: EntityManager,
  ): Promise<BalanceBreakdown> {
    const m = em ?? this.em.fork();
    const budgets = governedBudgetIds.length
      ? await m.find(Budget, { id: { $in: governedBudgetIds } }, FILTER_OFF)
      : [];
    const txns = budgets.length
      ? await m.find(BudgetTxn, { budget: { $in: budgets.map((b) => b.id) } }, FILTER_OFF)
      : [];

    const sum: Record<BudgetTxnType, string> = {
      [BudgetTxnType.ADJUST_INCREASE]: '0',
      [BudgetTxnType.ADJUST_DECREASE]: '0',
      [BudgetTxnType.TRANSFER_IN]: '0',
      [BudgetTxnType.TRANSFER_OUT]: '0',
      [BudgetTxnType.RESERVE]: '0',
      [BudgetTxnType.ACTUAL]: '0',
      [BudgetTxnType.RELEASE]: '0',
    };
    for (const t of txns) sum[t.txnType] = Money.add(sum[t.txnType], t.amount);

    const { ceiling, available } = await this.balanceAt(governedBudgetIds, capAmount, m);

    return {
      amountTotal: ceiling,
      adjustIncrease: sum[BudgetTxnType.ADJUST_INCREASE],
      adjustDecrease: sum[BudgetTxnType.ADJUST_DECREASE],
      transferIn: sum[BudgetTxnType.TRANSFER_IN],
      transferOut: sum[BudgetTxnType.TRANSFER_OUT],
      reserved: sum[BudgetTxnType.RESERVE],
      actual: sum[BudgetTxnType.ACTUAL],
      released: sum[BudgetTxnType.RELEASE],
      available,
    };
  }

  /**
   * The budget's append-only ledger entries, newest first, as a paged envelope.
   * Read-only (invariant 2). `total` is the full row count of the scoped ledger.
   */
  async ledger(
    budgetId: string,
    q: { page?: number; limit?: number; asOf?: string } = {},
    em?: EntityManager,
  ): Promise<Paginated<LedgerEntry>> {
    const m = em ?? this.em.fork();
    await this.requireInActiveCompany(budgetId, m);
    const { page, limit, offset } = pageParams(q);
    // Build the newest-first query via QueryBuilder rather than em.findAndCount: the
    // latter's normalized FindOptions get cached on the long-running EM and the ORDER BY
    // is silently dropped on the 2nd+ identical request (observed live). id breaks ties so
    // rows sharing a createdAt (same transaction, e.g. TRANSFER_OUT + TRANSFER_IN) are stable.
    const [txns, total] = await m
      .createQueryBuilder(BudgetTxn, 'b')
      .where({ budget: budgetId, ...asOfBound(q.asOf) })
      .orderBy({ createdAt: QueryOrder.DESC, id: QueryOrder.DESC })
      .limit(limit, offset)
      .getResultAndCount();
    // Resolve source document numbers in one query (avoids per-row relation loads).
    const docIds = [...new Set(txns.map((t) => t.document?.id).filter(Boolean) as string[])];
    const docs = docIds.length
      ? await m.find(Document, { id: { $in: docIds } }, FILTER_OFF)
      : [];
    const docNoById = new Map(docs.map((d) => [d.id, d.docNo]));
    const items = txns.map((t) => ({
      id: t.id,
      txnType: t.txnType,
      amount: t.amount,
      documentId: t.document?.id ?? null,
      documentNo: t.document?.id ? docNoById.get(t.document.id) ?? null : null,
      remark: t.remark ?? null,
      txnDate: t.txnDate,
      createdAt: t.createdAt ?? null,
    }));
    return { items, total, page, limit };
  }

  /** Load a budget, scoped to the active company via its fiscal year (invariant 1). */
  private async requireInActiveCompany(budgetId: string, em: EntityManager): Promise<Budget> {
    const companyId = RequestContext.companyId();
    // Scope through the join (fiscalYear.company) rather than reading a nested relation,
    // which isn't populated here and would throw on `.company.id`.
    const where = companyId ? { id: budgetId, fiscalYear: { company: companyId } } : { id: budgetId };
    const budget = await em.findOne(Budget, where, FILTER_OFF);
    if (!budget) throw new NotFoundException(`Budget ${budgetId} not found`);
    return budget;
  }

  /**
   * Outstanding reserved for one document+budget = Σ RESERVE − Σ RELEASE − Σ ACTUAL.
   * Drives exact settle / auto-release (invariant 4).
   */
  async outstandingReserved(
    documentId: string,
    budgetId: string,
    em?: EntityManager,
    asOf?: string,
  ): Promise<string> {
    const m = em ?? this.em.fork();
    const txns = await m.find(
      BudgetTxn,
      { document: documentId, budget: budgetId, ...asOfBound(asOf) },
      { filters: { company: false } },
    );
    // NOT the balance classification, and deliberately not `budgetTxnDirection`. This is the
    // OUTSTANDING formula — Σ RESERVE − Σ RELEASE − Σ ACTUAL — where a settlement genuinely does
    // reduce what is still held, because it is the part of the hold that has been consumed. The
    // balance leaves ACTUAL alone; outstanding subtracts it. Two formulas, one ledger.
    let reserved = '0';
    for (const t of txns) {
      if (t.txnType === BudgetTxnType.RESERVE) reserved = Money.add(reserved, t.amount);
      else if (t.txnType === BudgetTxnType.RELEASE || t.txnType === BudgetTxnType.ACTUAL) {
        reserved = Money.subtract(reserved, t.amount);
      }
    }
    return reserved;
  }
}
