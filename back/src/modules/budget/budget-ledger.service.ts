import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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
            throw new BadRequestException(
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
