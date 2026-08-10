import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { coded, ErrorCode } from '../../common/errors/error-code';
import { RequestContext } from '../../common/context/request-context';
import { BudgetTxnType } from '../../common/enums';
import { Money } from '../../common/money/money';
import { inTransaction, lockForUpdate } from '../../common/uow/unit-of-work';
import { Document } from '../document/document.entities';
import { AppUser } from '../rbac/rbac.entities';
import { BudgetBalanceService } from './budget-balance.service';
import { BudgetCoverageService, type GoverningControlPoint } from './budget-coverage.service';
import { Budget, BudgetControlPoint, BudgetTxn } from './budget.entities';
import { ToleranceLadder } from './tolerance-ladder';

export interface ReserveLine {
  budgetId: string;
  baseAmount: string; // company base currency (converted upstream)
}

const FILTER_OFF = { filters: { company: false } } as const;

/**
 * A soft over-limit, reported against the CONTROL POINT that raised it. It names the control
 * point rather than the budget because that is the ceiling that was approached — the budget the
 * user picked may still show plenty of room.
 */
export interface OverBudgetWarning {
  controlPointId: string;
  accountNodeId: string;
  departmentNodeId: string;
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
    private readonly coverage: BudgetCoverageService,
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
   * THE LOCK RULE FOR THIS MODULE.
   *
   * `budget_control_point` is the ONE lock class. Every operation that writes budget_txn locks
   * the control points governing the budgets it touches, in ascending id order, and NOTHING here
   * locks a `budget` row — a single sorted class is the only reason "no deadlock" is provable in
   * one line instead of argued about.
   *
   * That includes operations which cannot over-commit. `settle`, `releaseAll` and the
   * ancestor-hold check take these locks to be SERIALIZED, not to be checked: the hold check
   * reads exactly what a concurrent settlement is about to change, and the control point is now
   * the only row at which the two can meet. Exempting the "harmless" writers would put half the
   * truth about one budget behind a lock nobody else takes — which is how the standard model
   * (SAP FM totals record, Oracle funds checking) reasons about it too, and why reversals are
   * not exempt there either.
   *
   * Never returns nothing: a budget with no governing control point is a coverage fault, and is
   * rejected rather than treated as unrestricted.
   */
  private async lockControlPoints(
    tem: EntityManager,
    budgetIds: string[],
  ): Promise<Map<string, GoverningControlPoint[]>> {
    const coverage = await this.coverage.resolveControlPoints(budgetIds, tem);
    const uncovered = budgetIds.filter((id) => !(coverage.get(id) ?? []).length);
    if (uncovered.length) {
      throw coded(
        ErrorCode.BUDGET_EXCEEDED,
        `Budget ${uncovered[0]} is governed by no active budget control point, so its spending cannot be checked. This is a configuration fault, not an unlimited budget.`,
      );
    }
    const cpIds = [
      ...new Set([...coverage.values()].flat().map((cp) => cp.id)),
    ].sort();
    for (const cpId of cpIds) {
      await lockForUpdate(tem, BudgetControlPoint, { id: cpId }, FILTER_OFF);
    }
    return coverage;
  }

  /**
   * Reserve budget for a submitted document. One RESERVE per budget (lines summed), but the
   * CHECK happens at the governing control points, against the summed request — so a document
   * charging three budgets under one control point is measured against their total once, not
   * three times separately.
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
    const budgetIds = [...byBudget.keys()];
    if (!budgetIds.length) return { warnings: [] };

    // Lock every governing control point first, sorted, before reading any balance.
    const coverage = await this.lockControlPoints(tem, budgetIds);

    // Fold the request up to each control point. One budget appears under several points when
    // several govern it — deliberate: a submission must clear all of them, so its amount counts
    // once against each.
    const byCp = new Map<string, { cp: GoverningControlPoint; requested: string }>();
    for (const budgetId of budgetIds) {
      const requested = byBudget.get(budgetId)!;
      for (const cp of coverage.get(budgetId)!) {
        const entry = byCp.get(cp.id) ?? { cp, requested: '0' };
        entry.requested = Money.add(entry.requested, requested);
        byCp.set(cp.id, entry);
      }
    }

    const warnings: OverBudgetWarning[] = [];
    for (const cpId of [...byCp.keys()].sort()) {
      const { cp, requested } = byCp.get(cpId)!;
      const governed = await this.coverage.budgetsGovernedBy(cpId, tem);
      const { ceiling, used, available } = await this.balance.balanceAt(
        governed,
        cp.capAmount,
        tem,
      );
      const outcome = ToleranceLadder.evaluate(ToleranceLadder.parseJson(cp.toleranceJson), {
        ceiling,
        used,
        requested,
      });
      if (outcome === 'BLOCK') {
        // Coded here, where the refusal is decided, rather than at whichever endpoint called
        // in — so a path added later inherits it without anyone remembering to. The message
        // names the CONTROL POINT, not the budget: the submitter picked a line that may still
        // show room, and a refusal they cannot explain is what drives spend onto the wrong line.
        throw coded(
          ErrorCode.BUDGET_EXCEEDED,
          `Over budget at control point ${cpId} (account node ${cp.accountNodeId}, department node ${cp.departmentNodeId}): ${requested} requested, ${available} available`,
        );
      }
      if (outcome === 'WARN') {
        warnings.push({
          controlPointId: cpId,
          accountNodeId: cp.accountNodeId,
          departmentNodeId: cp.departmentNodeId,
          requested,
          available,
        });
      }
    }

    // Posting is unchanged: one RESERVE per budget, at the leaf (invariants 2 and 4).
    for (const budgetId of [...byBudget.keys()].sort()) {
      this.insertTxn(tem, budgetId, documentId, BudgetTxnType.RESERVE, byBudget.get(budgetId)!);
    }
    return { warnings };
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
    // Lock the governing control points before reading the outstanding holds, in the same sorted
    // order reserve() uses: otherwise a concurrent settle of the ancestor could release between
    // this check and the caller's reserve, leaving the chain holding nothing at all. The lock is
    // taken on control points, not budgets, because `settle` now meets us there too — see the
    // lock rule on lockControlPoints. Nothing here is checked against a ceiling; this is
    // serialization only.
    await this.lockControlPoints(m, [...pending]);
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
      // Settlement cannot over-commit — it converts a hold that already reduced the balance — but
      // it still takes the control-point locks, because the ancestor-hold check reads exactly the
      // outstanding value this method is about to change, and the control point is the only row
      // where the two meet (see lockControlPoints).
      await this.lockControlPoints(tem, [budgetId]);
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
      if (!budgetIds.length) return;
      // Same reasoning as settle: releasing only ever returns money, but it is a read-modify-write
      // of the same outstanding value the hold check reads, so it serializes on the control points.
      await this.lockControlPoints(tem, budgetIds);
      for (const budgetId of budgetIds) {
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

      // Lock BOTH endpoints' governing control points, as one sorted set. The destination is
      // locked even though TRANSFER_IN only adds availability: it may be governed by a control
      // point that a concurrent reservation is also using, and a second sort order is a
      // deadlock waiting for the first transfer that runs the other way.
      const coverage = await this.lockControlPoints(tem, [fromBudgetId, toBudgetId]);

      // Sufficiency is decided at the SOURCE's control points, not at the source budget row: a
      // transfer out of a line is a draw on every ceiling that governs that line.
      for (const cp of coverage.get(fromBudgetId)!) {
        const governed = await this.coverage.budgetsGovernedBy(cp.id, tem);
        const { ceiling, used, available } = await this.balance.balanceAt(
          governed,
          cp.capAmount,
          tem,
        );
        const outcome = ToleranceLadder.evaluate(ToleranceLadder.parseJson(cp.toleranceJson), {
          ceiling,
          used,
          requested: amount,
        });
        if (outcome === 'BLOCK') {
          throw new BadRequestException(
            `Transfer ${amount} exceeds available ${available} at control point ${cp.id} governing the source budget`,
          );
        }
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
      // Locked, deliberately not checked: an approved adjustment is an instruction, so an
      // ADJUST_DECREASE may take a control point negative. That was already true of the
      // per-budget check it replaces — only the row being locked has changed.
      await this.lockControlPoints(tem, [input.budgetId]);
      this.insertTxn(tem, input.budgetId, input.documentId, txnType, input.amount);
    };
    return em ? run(em) : inTransaction(this.em, run);
  }
}
