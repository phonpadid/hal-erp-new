import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { coded, ErrorCode } from '../../common/errors/error-code';
import { RequestContext } from '../../common/context/request-context';
import { BudgetTxnType, ControlPolicy } from '../../common/enums';
import { Money } from '../../common/money/money';
import { inTransaction, lockForUpdate } from '../../common/uow/unit-of-work';
import { Document } from '../document/document.entities';
import { AppUser } from '../rbac/rbac.entities';
import { BudgetBalanceService } from './budget-balance.service';
import { Budget, BudgetTxn } from './budget.entities';

export interface ReserveLine {
  budgetId: string;
  baseAmount: string; // company base currency (converted upstream)
}

const FILTER_OFF = { filters: { company: false } } as const;

export interface OverBudgetWarning {
  budgetId: string;
  requested: string;
  available: string;
}

/**
 * Budget ledger engine (invariants 2, 3, 4 + concurrency). Every write is an
 * insert into the append-only budget_txn, inside a single transaction; budgets
 * are locked FOR UPDATE before checking/committing to prevent over-commit.
 */
@Injectable()
export class BudgetLedgerService {
  constructor(
    private readonly em: EntityManager,
    private readonly balance: BudgetBalanceService,
  ) {}

  private insertTxn(
    tem: EntityManager,
    budgetId: string,
    documentId: string,
    txnType: BudgetTxnType,
    amount: string,
    remark?: string,
  ): void {
    const userId = RequestContext.userId();
    const txn = tem.create(BudgetTxn, {
      budget: tem.getReference(Budget, budgetId),
      document: tem.getReference(Document, documentId),
      txnType,
      amount,
      remark,
      createdBy: userId ? tem.getReference(AppUser, userId) : undefined,
      createdAt: new Date(),
    });
    tem.persist(txn);
  }

  /**
   * Reserve budget for a submitted document. One RESERVE per budget (lines summed).
   * HARD_STOP rejects the whole submit if any budget is insufficient (rolls back);
   * SOFT_WARNING proceeds and returns warnings.
   */
  async reserve(
    documentId: string,
    lines: ReserveLine[],
    em?: EntityManager,
  ): Promise<{ warnings: OverBudgetWarning[] }> {
    return em
      ? this.reserveIn(em, documentId, lines)
      : inTransaction(this.em, (tem) => this.reserveIn(tem, documentId, lines));
  }

  private async reserveIn(
    tem: EntityManager,
    documentId: string,
    lines: ReserveLine[],
  ): Promise<{ warnings: OverBudgetWarning[] }> {
    const byBudget = new Map<string, string>();
    for (const line of lines) {
      byBudget.set(line.budgetId, Money.add(byBudget.get(line.budgetId) ?? '0', line.baseAmount));
    }
    // Deterministic lock order avoids deadlocks across concurrent submits.
    const budgetIds = [...byBudget.keys()].sort();

    {
      const warnings: OverBudgetWarning[] = [];
      for (const budgetId of budgetIds) {
        const budget = await lockForUpdate(tem, Budget, { id: budgetId }, { filters: { company: false } });
        if (!budget) throw new NotFoundException(`Budget ${budgetId} not found`);

        const requested = byBudget.get(budgetId)!;
        const available = await this.balance.availableBalance(budgetId, tem);
        if (Money.compare(requested, available) > 0) {
          if (budget.controlPolicy === ControlPolicy.HARD_STOP) {
            // Coded here, where the refusal is decided, rather than at whichever endpoint called
            // in — so a path added later inherits it without anyone remembering to. The caller's
            // reaction is distinct: hold the work, tell someone, retry once the budget is topped up.
            throw coded(
              ErrorCode.BUDGET_EXCEEDED,
              `Over budget: ${requested} requested, ${available} available on budget ${budgetId}`,
            );
          }
          warnings.push({ budgetId, requested, available });
        }
        this.insertTxn(tem, budgetId, documentId, BudgetTxnType.RESERVE, requested);
      }
      return { warnings };
    }
  }

  /**
   * Of `budgetIds`, those whose money a ref-chain ancestor of `documentId` is ALREADY holding as
   * an outstanding RESERVE — the caller must not reserve them again.
   *
   * A successor created from an approved predecessor (PROC→PO→DISB) copies the predecessor's lines
   * budget and all, so a budget-controlled successor would reserve the same money a second time.
   * Only ONE of those reservations is ever settled — PostActionService walks ref_document_id back
   * to the holder and settles that one — so the other stays RESERVE forever, silently eating the
   * budget with no release path (a completed document is never auto-released). The ancestor's hold
   * IS the chain's hold: it was taken for this spend and is converted to ACTUAL when the settling
   * successor is approved.
   */
  async budgetsHeldByAncestors(
    documentId: string,
    budgetIds: string[],
    em?: EntityManager,
  ): Promise<Set<string>> {
    const m = em ?? this.em.fork();
    const held = new Set<string>();
    const pending = new Set(budgetIds);
    if (!pending.size) return held;
    // Lock the budgets before reading their outstanding holds, in the same deterministic order
    // reserve() uses (no deadlock): otherwise a concurrent settle of the ancestor could release
    // between this check and the caller's reserve, leaving the chain holding nothing at all.
    for (const budgetId of [...pending].sort()) {
      await lockForUpdate(m, Budget, { id: budgetId }, FILTER_OFF);
    }
    const seen = new Set<string>([documentId]);
    let currentId = (
      await m.findOne(Document, { id: documentId }, { ...FILTER_OFF, populate: ['refDocument'] })
    )?.refDocument?.id;
    while (currentId && !seen.has(currentId) && pending.size) {
      seen.add(currentId);
      for (const budgetId of [...pending]) {
        // Outstanding, not merely "has a RESERVE row": a predecessor already settled (ACTUAL +
        // RELEASE) holds nothing, so its successor must take its own hold.
        const outstanding = await this.balance.outstandingReserved(currentId, budgetId, m);
        if (Money.compare(outstanding, '0') > 0) {
          held.add(budgetId);
          pending.delete(budgetId);
        }
      }
      const ancestor = await m.findOne(
        Document,
        { id: currentId },
        { ...FILTER_OFF, populate: ['refDocument'] },
      );
      currentId = ancestor?.refDocument?.id;
    }
    return held;
  }

  /** Convert reservation to actual: ACTUAL the consumed amount, RELEASE the remainder. */
  async settle(
    documentId: string,
    budgetId: string,
    actualAmount: string,
    em?: EntityManager,
  ): Promise<void> {
    const run = async (tem: EntityManager) => {
      await lockForUpdate(tem, Budget, { id: budgetId }, { filters: { company: false } });
      const outstanding = await this.balance.outstandingReserved(documentId, budgetId, tem);
      if (Money.compare(actualAmount, outstanding) > 0) {
        throw new BadRequestException(
          `Actual ${actualAmount} exceeds outstanding reserved ${outstanding}`,
        );
      }
      this.insertTxn(tem, budgetId, documentId, BudgetTxnType.ACTUAL, actualAmount);
      const release = Money.subtract(outstanding, actualAmount);
      if (Money.compare(release, '0') > 0) {
        this.insertTxn(tem, budgetId, documentId, BudgetTxnType.RELEASE, release);
      }
    };
    return em ? run(em) : inTransaction(this.em, run);
  }

  /** Reject/cancel: release all outstanding reserved for the document (invariant 4). */
  async releaseAll(documentId: string, em?: EntityManager): Promise<void> {
    const run = async (tem: EntityManager) => {
      const reserveTxns = await tem.find(
        BudgetTxn,
        { document: documentId, txnType: BudgetTxnType.RESERVE },
        { filters: { company: false } },
      );
      const budgetIds = [...new Set(reserveTxns.map((t) => t.budget.id))].sort();
      for (const budgetId of budgetIds) {
        await lockForUpdate(tem, Budget, { id: budgetId }, { filters: { company: false } });
        const outstanding = await this.balance.outstandingReserved(documentId, budgetId, tem);
        if (Money.compare(outstanding, '0') > 0) {
          this.insertTxn(tem, budgetId, documentId, BudgetTxnType.RELEASE, outstanding);
        }
      }
    };
    return em ? run(em) : inTransaction(this.em, run);
  }

  /**
   * Execute an approved transfer: paired TRANSFER_OUT + TRANSFER_IN, atomic.
   * Rejects cross-company / cross-fiscal-year and insufficient source balance.
   */
  async executeTransfer(
    input: {
      documentId: string;
      fromBudgetId: string;
      toBudgetId: string;
      amount: string;
    },
    em?: EntityManager,
  ): Promise<void> {
    const { documentId, fromBudgetId, toBudgetId, amount } = input;
    if (fromBudgetId === toBudgetId) {
      throw new BadRequestException('Transfer source and target budgets are the same');
    }
    const run = async (tem: EntityManager) => {
      const from = await tem.findOne(
        Budget,
        { id: fromBudgetId },
        { populate: ['department', 'fiscalYear'], filters: { company: false } },
      );
      const to = await tem.findOne(
        Budget,
        { id: toBudgetId },
        { populate: ['department', 'fiscalYear'], filters: { company: false } },
      );
      if (!from || !to) throw new NotFoundException('Transfer budget not found');

      if (from.department.company.id !== to.department.company.id) {
        throw new BadRequestException('Cross-company budget transfer is forbidden');
      }
      if (from.fiscalYear.id !== to.fiscalYear.id) {
        throw new BadRequestException('Cross-fiscal-year budget transfer is forbidden');
      }

      // Lock both in deterministic order.
      for (const id of [fromBudgetId, toBudgetId].sort()) {
        await lockForUpdate(tem, Budget, { id }, { filters: { company: false } });
      }
      const available = await this.balance.availableBalance(fromBudgetId, tem);
      if (Money.compare(amount, available) > 0) {
        throw new BadRequestException(
          `Transfer ${amount} exceeds available ${available} on source budget`,
        );
      }
      this.insertTxn(tem, fromBudgetId, documentId, BudgetTxnType.TRANSFER_OUT, amount);
      this.insertTxn(tem, toBudgetId, documentId, BudgetTxnType.TRANSFER_IN, amount);
    };
    return em ? run(em) : inTransaction(this.em, run);
  }

  /** Execute an approved adjustment: a single ADJUST_INCREASE / ADJUST_DECREASE. */
  async executeAdjustment(
    input: {
      documentId: string;
      budgetId: string;
      amount: string;
      movementType: 'ADJUST_INCREASE' | 'ADJUST_DECREASE';
    },
    em?: EntityManager,
  ): Promise<void> {
    const txnType =
      input.movementType === 'ADJUST_INCREASE'
        ? BudgetTxnType.ADJUST_INCREASE
        : BudgetTxnType.ADJUST_DECREASE;
    const run = async (tem: EntityManager) => {
      await lockForUpdate(tem, Budget, { id: input.budgetId }, { filters: { company: false } });
      this.insertTxn(tem, input.budgetId, input.documentId, txnType, input.amount);
    };
    return em ? run(em) : inTransaction(this.em, run);
  }
}
