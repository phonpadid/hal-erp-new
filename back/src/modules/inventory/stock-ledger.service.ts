import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { StockTxnType } from '../../common/enums';
import { paginate, type Paginated } from '../../common/pagination/pagination';
import { QTY_SCALE } from './stock-balance.service';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { Money } from '../../common/money/money';
import { Document, DocumentLine } from '../document/document.entities';
import { Item } from '../master-data/master-data.entities';
import { Company } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { StockTxn, Warehouse } from './inventory.entities';
import type { StockLedgerQueryDto } from './dto/stock.dto';

/** What a caller must supply to record one movement. */
export interface StockMovementInput {
  itemId: string;
  warehouseId: string;
  txnType: StockTxnType;
  /** Always positive — direction comes from `txnType`, never from a sign. */
  qty: string;
  /** Base-currency cost per unit. Omitted for RESERVE/RELEASE, which move no value. */
  unitCost?: string;
  documentId?: string;
  documentLineId?: string;
  remark?: string;
}

/** A movement row plus the on-hand balance immediately after it. */
export interface StockLedgerRow {
  id: string;
  txnType: StockTxnType;
  qty: string;
  unitCost?: string;
  warehouseId: string;
  warehouseCode: string;
  documentId?: string;
  docNo?: string;
  remark?: string;
  createdAt?: Date;
  /** Running on-hand after this row. RESERVE/RELEASE leave it unchanged — they move availability. */
  balanceAfter: string;
}

/** Types that add to on-hand. RESERVE/RELEASE are absent: they move availability, not stock. */
const INBOUND = new Set<StockTxnType>([
  StockTxnType.RECEIVE,
  StockTxnType.TRANSFER_IN,
  StockTxnType.ADJUST_INCREASE,
]);

/** Types that remove from on-hand. */
const OUTBOUND = new Set<StockTxnType>([
  StockTxnType.ISSUE,
  StockTxnType.TRANSFER_OUT,
  StockTxnType.ADJUST_DECREASE,
]);

/** Signed contribution of a movement to on-hand quantity: +qty, -qty, or 0. */
export function onHandDelta(txnType: StockTxnType, qty: string): string {
  if (INBOUND.has(txnType)) return qty;
  if (OUTBOUND.has(txnType)) return Money.multiply(qty, '-1');
  return '0';
}

/** Signed contribution to reserved quantity: RESERVE holds, RELEASE and ISSUE discharge. */
export function reservedDelta(txnType: StockTxnType, qty: string): string {
  if (txnType === StockTxnType.RESERVE) return qty;
  if (txnType === StockTxnType.RELEASE || txnType === StockTxnType.ISSUE) {
    return Money.multiply(qty, '-1');
  }
  return '0';
}

/**
 * The single writer for `stock_txn` — an APPEND-ONLY ledger (invariant 2), like `budget_txn`.
 * There is deliberately no update or delete method: a correction to stock is a new movement, not
 * a rewrite of the one that was recorded.
 *
 * Every write helper takes an `EntityManager`, so the caller owns the transaction boundary. A
 * movement must commit atomically with the `stock_balance` it implies, and paired
 * TRANSFER_OUT/TRANSFER_IN rows must never be split — neither is possible if this service opened
 * its own transaction.
 */
@Injectable()
export class StockLedgerService {
  constructor(private readonly scope: CompanyScopeService) {}

  /**
   * Insert one movement. Does NOT touch `stock_balance` — the caller updates the projection in
   * the same transaction, under the lock it already holds.
   */
  record(tem: EntityManager, input: StockMovementInput): StockTxn {
    const companyId = RequestContext.companyId()!;
    const userId = RequestContext.userId();
    const txn = tem.create(StockTxn, {
      company: tem.getReference(Company, companyId),
      item: tem.getReference(Item, input.itemId),
      warehouse: tem.getReference(Warehouse, input.warehouseId),
      txnType: input.txnType,
      qty: input.qty,
      unitCost: input.unitCost,
      document: input.documentId ? tem.getReference(Document, input.documentId) : undefined,
      documentLine: input.documentLineId
        ? tem.getReference(DocumentLine, input.documentLineId)
        : undefined,
      remark: input.remark,
      createdBy: userId ? tem.getReference(AppUser, userId) : undefined,
      createdAt: new Date(),
    });
    tem.persist(txn);
    return txn;
  }

  /** Insert several movements in one go, preserving order. */
  recordMany(tem: EntityManager, inputs: StockMovementInput[]): StockTxn[] {
    return inputs.map((input) => this.record(tem, input));
  }

  /**
   * Movement history for one item in the active company, oldest first, with a running on-hand
   * balance so a surprising figure can be traced to the movement that produced it.
   *
   * The running balance is computed over the returned page in insertion order. When a warehouse
   * filter is absent the item's movements across warehouses interleave, so the running figure is
   * the item's total across the company — which is what a company-wide history should show.
   */
  async history(q: StockLedgerQueryDto): Promise<Paginated<StockLedgerRow>> {
    const companyId = RequestContext.companyId()!;
    const where: Record<string, unknown> = { company: companyId, item: q.itemId };
    if (q.warehouseId) where.warehouse = q.warehouseId;

    const page = await paginate(
      this.scope.forActiveCompany(),
      StockTxn,
      where,
      {
        populate: ['warehouse', 'document'],
        orderBy: { createdAt: 'ASC', id: 'ASC' },
      },
      q,
    );

    // The opening balance for this page is everything that happened before its first row, so
    // page 2's running total continues page 1's rather than restarting at zero.
    const { offset } = { offset: (page.page - 1) * page.limit };
    let running = offset > 0 ? await this.onHandBefore(where, page.items[0]) : '0';

    const items: StockLedgerRow[] = page.items.map((txn) => {
      running = Money.add(running, onHandDelta(txn.txnType, txn.qty));
      return {
        id: txn.id,
        txnType: txn.txnType,
        qty: txn.qty,
        unitCost: txn.unitCost,
        warehouseId: txn.warehouse.id,
        warehouseCode: txn.warehouse.code,
        documentId: txn.document?.id,
        docNo: txn.document?.docNo,
        remark: txn.remark,
        createdAt: txn.createdAt,
        // Same scale as every other quantity the API emits, so the client formats one way.
        balanceAfter: Money.round(running, QTY_SCALE),
      };
    });

    return { ...page, items };
  }

  /** On-hand accumulated by every movement strictly before `first`, for a page's opening balance. */
  private async onHandBefore(
    where: Record<string, unknown>,
    first: StockTxn | undefined,
  ): Promise<string> {
    if (!first) return '0';
    const earlier = await this.scope.forActiveCompany().find(
      StockTxn,
      { ...where, createdAt: { $lt: first.createdAt } } as never,
      { orderBy: { createdAt: 'ASC' } },
    );
    return earlier.reduce((sum, txn) => Money.add(sum, onHandDelta(txn.txnType, txn.qty)), '0');
  }
}
