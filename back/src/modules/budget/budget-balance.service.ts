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
   *             − TRANSFER_OUT − RESERVE − ACTUAL + RELEASE  (company base currency)
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
        case BudgetTxnType.ACTUAL:
          balance = Money.subtract(balance, t.amount);
          break;
      }
    }
    return balance;
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
    available = Money.subtract(available, sum[BudgetTxnType.ACTUAL]);
    available = Money.add(available, sum[BudgetTxnType.RELEASE]);

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
