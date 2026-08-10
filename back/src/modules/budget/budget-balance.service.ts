import { EntityManager, QueryOrder } from '@mikro-orm/postgresql';
import { Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { BudgetTxnType } from '../../common/enums';
import { Money } from '../../common/money/money';
import { pageParams, type Paginated } from '../../common/pagination/pagination';
import { Document } from '../document/document.entities';
import { Budget, BudgetTxn } from './budget.entities';

const FILTER_OFF = { filters: { company: false } } as const;

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
  async availableBalance(budgetId: string, em?: EntityManager): Promise<string> {
    // Fork when not invoked inside a caller's transaction (controller path), so we never
    // touch the global EntityManager outside a request context.
    const m = em ?? this.em.fork();
    // Budget isn't company-scoped, but it relates to scoped fiscalYear/department;
    // disable the company filter so these ledger reads don't demand its params.
    const budget = await m.findOne(Budget, { id: budgetId }, { filters: { company: false } });
    if (!budget) throw new NotFoundException(`Budget ${budgetId} not found`);
    const txns = await m.find(BudgetTxn, { budget: budgetId }, { filters: { company: false } });

    let balance = budget.amountTotal;
    for (const t of txns) {
      switch (t.txnType) {
        case BudgetTxnType.ADJUST_INCREASE:
        case BudgetTxnType.TRANSFER_IN:
        case BudgetTxnType.RELEASE:
          balance = Money.add(balance, t.amount);
          break;
        case BudgetTxnType.ADJUST_DECREASE:
        case BudgetTxnType.TRANSFER_OUT:
        case BudgetTxnType.RESERVE:
          balance = Money.subtract(balance, t.amount);
          break;
        case BudgetTxnType.ACTUAL:
          break; // draws down the reservation, not a second deduction (see above)
      }
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
      switch (t.txnType) {
        case BudgetTxnType.ADJUST_INCREASE:
        case BudgetTxnType.TRANSFER_IN:
        case BudgetTxnType.RELEASE:
          out.set(bid, Money.add(bal, t.amount));
          break;
        case BudgetTxnType.ADJUST_DECREASE:
        case BudgetTxnType.TRANSFER_OUT:
        case BudgetTxnType.RESERVE:
          out.set(bid, Money.subtract(bal, t.amount));
          break;
        case BudgetTxnType.ACTUAL:
          break; // draws down the reservation, not a second deduction (see availableBalance)
      }
    }
    return out;
  }

  /**
   * The derived balance broken into its components — all summed from budget_txn, in the
   * company base currency. available reuses the availableBalance formula so they never
   * diverge. Scoped to the active company via the budget's fiscal year.
   */
  async breakdown(budgetId: string, em?: EntityManager): Promise<BalanceBreakdown> {
    const m = em ?? this.em.fork();
    const budget = await this.requireInActiveCompany(budgetId, m);
    const txns = await m.find(BudgetTxn, { budget: budgetId }, FILTER_OFF);

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
      // A control point governing nothing is a configuration fault, not an unlimited budget.
      // Callers reject before reaching here; returning a zero ceiling keeps this honest if one
      // ever does not.
      return { ceiling: '0', used: '0', available: '0' };
    }
    const budgets = await m.find(Budget, { id: { $in: governedBudgetIds } }, FILTER_OFF);
    let rollup = '0';
    for (const b of budgets) rollup = Money.add(rollup, b.amountTotal);
    const ceiling = capAmount ?? rollup;

    const txns = await m.find(
      BudgetTxn,
      { budget: { $in: budgets.map((b) => b.id) } },
      FILTER_OFF,
    );
    // `used` is what the ceiling has been drawn down by, expressed so that
    // available = ceiling − used holds for both the rollup and the cap_amount case.
    let used = '0';
    for (const t of txns) {
      switch (t.txnType) {
        case BudgetTxnType.ADJUST_INCREASE:
        case BudgetTxnType.TRANSFER_IN:
        case BudgetTxnType.RELEASE:
          used = Money.subtract(used, t.amount);
          break;
        case BudgetTxnType.ADJUST_DECREASE:
        case BudgetTxnType.TRANSFER_OUT:
        case BudgetTxnType.RESERVE:
          used = Money.add(used, t.amount);
          break;
        case BudgetTxnType.ACTUAL:
          break; // draws down the reservation, not a second deduction (see availableBalance)
      }
    }
    return { ceiling, used, available: Money.subtract(ceiling, used) };
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
    q: { page?: number; limit?: number } = {},
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
      .where({ budget: budgetId })
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
  ): Promise<string> {
    const m = em ?? this.em.fork();
    const txns = await m.find(
      BudgetTxn,
      { document: documentId, budget: budgetId },
      { filters: { company: false } },
    );
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
