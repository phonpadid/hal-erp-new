import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable } from '@nestjs/common';
import { Money } from '../../common/money/money';
import { StockTxnType } from '../../common/enums';
import { Document, DocumentLine } from '../document/document.entities';
import { StockTxn } from './inventory.entities';
import {
  aggregateByPair,
  QTY_SCALE,
  StockBalanceService,
  type StockPair,
} from './stock-balance.service';
import { StockLedgerService } from './stock-ledger.service';

const FILTER_OFF = { filters: { company: false } } as const;

/** One line's demand on a warehouse, after the document has been resolved. */
export interface StockDemandLine extends StockPair {
  qty: string;
  lineNo: number;
  documentLineId?: string;
}

/** The stock a document intends to move, with the warehouse already resolved per line. */
export interface StockDemand {
  documentId: string;
  lines: StockDemandLine[];
}

/**
 * Reserve → issue → release for stock, hooked at the same three lifecycle points as budget
 * (invariant 4):
 *
 * | Lifecycle event | Budget         | Stock                                  |
 * |-----------------|----------------|----------------------------------------|
 * | Submit          | RESERVE        | RESERVE, after an availability check    |
 * | Full approval   | ACTUAL         | ISSUE (+ GL posting)                    |
 * | Reject / cancel | RELEASE        | RELEASE                                 |
 *
 * Availability is enforced at SUBMIT, when the reservation is taken — not at approval. Blocking
 * at approval would let a document sail through four approvers and die at the last step, and the
 * approver would be blamed for a shortage they did not cause. Reserving at submit makes the
 * shortage the requester's to fix and makes the hold real for everyone queued behind them.
 */
@Injectable()
export class StockMovementService {
  constructor(
    private readonly balances: StockBalanceService,
    private readonly ledger: StockLedgerService,
  ) {}

  /**
   * Hold stock for a document. Runs inside the caller's transaction (the submit transaction), so
   * a reservation and the document's transition to SUBMITTED commit together.
   *
   * Lines are aggregated by `(item, warehouse)` BEFORE anything is locked or checked: a document
   * with the same item on two lines must be tested against the combined quantity, or two lines of
   * 6 each pass individually against 10 available and oversell by 2.
   */
  async reserve(tem: EntityManager, demand: StockDemand): Promise<void> {
    if (!demand.lines.length) return;

    const wanted = aggregateByPair(demand.lines);
    // Lock first, check second. The reverse order is exactly how two concurrent submits both read
    // "10 available" and both succeed.
    const locked = await this.balances.lockPairs(tem, wanted);

    const short: string[] = [];
    for (const pair of wanted) {
      const balance = locked.get(`${pair.itemId}:${pair.warehouseId}`)!;
      const available = StockBalanceService.available(balance);
      if (Money.compare(available, pair.qty) < 0) {
        short.push(
          `item ${pair.itemId} in warehouse ${pair.warehouseId}: need ${Money.round(pair.qty, QTY_SCALE)}, available ${available}`,
        );
      }
    }
    // All-or-nothing: any shortfall rejects the whole submit, and because we have written nothing
    // yet there is no partial reservation to unwind.
    if (short.length) {
      throw new BadRequestException(`Insufficient stock — ${short.join('; ')}`);
    }

    for (const pair of wanted) {
      const balance = locked.get(`${pair.itemId}:${pair.warehouseId}`)!;
      this.balances.applyMovement(balance, StockTxnType.RESERVE, pair.qty);
      this.ledger.record(tem, {
        itemId: pair.itemId,
        warehouseId: pair.warehouseId,
        txnType: StockTxnType.RESERVE,
        qty: pair.qty,
        documentId: demand.documentId,
      });
    }
    await tem.flush();
  }

  /**
   * Convert a document's reservation into a real issue on full approval. Locks the same pairs in
   * the same order, stamps each row with the cost it consumed at, and discharges the hold.
   */
  async issue(tem: EntityManager, demand: StockDemand): Promise<StockTxn[]> {
    if (!demand.lines.length) return [];

    const wanted = aggregateByPair(demand.lines);
    const locked = await this.balances.lockPairs(tem, wanted);
    const written: StockTxn[] = [];

    for (const pair of wanted) {
      const balance = locked.get(`${pair.itemId}:${pair.warehouseId}`)!;
      const unitCost = this.balances.applyMovement(balance, StockTxnType.ISSUE, pair.qty);
      written.push(
        this.ledger.record(tem, {
          itemId: pair.itemId,
          warehouseId: pair.warehouseId,
          txnType: StockTxnType.ISSUE,
          qty: pair.qty,
          unitCost,
          documentId: demand.documentId,
        }),
      );
    }
    await tem.flush();
    return written;
  }

  /**
   * Release whatever a document still holds. Idempotent by construction: the outstanding hold is
   * derived from the document's own ledger rows (Σ RESERVE − Σ RELEASE − Σ ISSUE), so a document
   * that has already been released — or whose reservation was converted by an issue — computes
   * zero outstanding and writes nothing.
   *
   * That derivation is also why a partially-issued document releases only the remainder rather
   * than the original reservation.
   */
  async release(tem: EntityManager, documentId: string): Promise<void> {
    const rows = await tem.find(
      StockTxn,
      { document: documentId },
      { populate: ['item', 'warehouse'], ...FILTER_OFF },
    );
    if (!rows.length) return;

    // Outstanding hold per pair, from this document's own rows.
    const outstanding = new Map<string, StockPair & { qty: string }>();
    for (const row of rows) {
      const key = `${row.item.id}:${row.warehouse.id}`;
      const entry =
        outstanding.get(key) ??
        (() => {
          const fresh = { itemId: row.item.id, warehouseId: row.warehouse.id, qty: '0' };
          outstanding.set(key, fresh);
          return fresh;
        })();
      if (row.txnType === StockTxnType.RESERVE) entry.qty = Money.add(entry.qty, row.qty);
      else if (row.txnType === StockTxnType.RELEASE || row.txnType === StockTxnType.ISSUE) {
        entry.qty = Money.subtract(entry.qty, row.qty);
      }
    }

    const toRelease = [...outstanding.values()].filter((e) => Money.compare(e.qty, '0') > 0);
    if (!toRelease.length) return;

    const locked = await this.balances.lockPairs(tem, toRelease);
    for (const pair of toRelease) {
      const balance = locked.get(`${pair.itemId}:${pair.warehouseId}`)!;
      this.balances.applyMovement(balance, StockTxnType.RELEASE, pair.qty);
      this.ledger.record(tem, {
        itemId: pair.itemId,
        warehouseId: pair.warehouseId,
        txnType: StockTxnType.RELEASE,
        qty: pair.qty,
        documentId,
        remark: 'auto-release on reject/cancel',
      });
    }
    await tem.flush();
  }

  /**
   * Apply a stock adjustment: a correction to what is already on the shelf.
   *
   * Direction is per line — a count session finds some items over and others short — and is read
   * from the sign of the line's quantity, since `document_line.qty` is the only per-line number a
   * configured form already collects.
   *
   * A decrease consumes at the prevailing average. An increase takes its cost from the line, the
   * same basis a goods receipt uses, and falls back to the prevailing average only when the line
   * carries no value. Reading the average first would value an opening count into an empty
   * warehouse at zero — stock would exist physically with no book value and, because a zero-value
   * movement posts nothing, no GL entry at all.
   *
   * An adjustment takes no reservation: there is nothing to hold, and a decrease is checked here,
   * when it is applied.
   */
  async adjust(tem: EntityManager, document: Document, warehouseId: string): Promise<StockTxn[]> {
    const lines = await tem.find(
      DocumentLine,
      { document: document.id },
      { populate: ['item'], orderBy: { lineNo: 'ASC' }, ...FILTER_OFF },
    );

    const pairs = lines
      .filter((l) => l.item)
      .map((l) => ({ itemId: l.item!.id, warehouseId }));
    const locked = await this.balances.lockPairs(tem, pairs);
    const written: StockTxn[] = [];

    for (const line of lines) {
      if (!line.item) {
        throw new BadRequestException(`Line ${line.lineNo} has no item; an adjustment must name one`);
      }
      if (!line.item.isStockTracked) {
        throw new BadRequestException(
          `Line ${line.lineNo} names '${line.item.itemCode}', which is not stock-tracked`,
        );
      }
      const signed = Money.compare(line.qty, '0');
      if (signed === 0) continue; // an adjustment of nothing is not an error, just a no-op

      const balance = locked.get(`${line.item.id}:${warehouseId}`)!;
      const magnitude = signed > 0 ? line.qty : Money.multiply(line.qty, '-1');
      const txnType = signed > 0 ? StockTxnType.ADJUST_INCREASE : StockTxnType.ADJUST_DECREASE;

      // A write-off cannot take out more than is there — the ledger must never imply a negative
      // shelf. Reserved stock is deliberately NOT subtracted: a shortage is physically gone, and
      // refusing to record it because a document has a claim on it would leave the books lying.
      if (txnType === StockTxnType.ADJUST_DECREASE && Money.compare(balance.qtyOnHand, magnitude) < 0) {
        throw new BadRequestException(
          `Line ${line.lineNo} would take ${magnitude} of '${line.item.itemCode}' from a balance of ${balance.qtyOnHand}`,
        );
      }

      const unitCost = this.balances.applyMovement(
        balance,
        txnType,
        magnitude,
        txnType === StockTxnType.ADJUST_INCREASE ? this.adjustInCost(line, magnitude, balance.avgCost) : undefined,
      );
      written.push(
        this.ledger.record(tem, {
          itemId: line.item.id,
          warehouseId,
          txnType,
          qty: magnitude,
          unitCost,
          documentId: document.id,
          documentLineId: line.id,
          remark: line.description,
        }),
      );
    }
    await tem.flush();
    return written;
  }

  /**
   * Cost per unit for an increase adjustment.
   *
   * Prefers `budget_base_line_amount` — the base-currency figure stamped at the locked submit-time
   * rate, exactly what a goods receipt reads — then the plain base amount, then the line's unit
   * price, and only then the prevailing average. The fallback chain matters because the first
   * adjustment into an empty warehouse has no average to inherit.
   */
  private adjustInCost(line: DocumentLine, qty: string, prevailingAvg: string): string {
    const baseAmount = line.budgetBaseLineAmount ?? line.baseLineAmount;
    if (baseAmount && Money.compare(qty, '0') > 0 && Money.compare(baseAmount, '0') > 0) {
      return Money.divide(baseAmount, qty);
    }
    if (Money.compare(line.unitPrice, '0') > 0) return line.unitPrice;
    return prevailingAvg;
  }

  /**
   * Move stock between two warehouses of one company.
   *
   * The paired TRANSFER_OUT and TRANSFER_IN are written in the caller's single transaction, so
   * neither can exist without the other — the same guarantee budget transfers already give. The
   * destination receives at the SOURCE's average cost, so moving goods between shelves never
   * revalues them; only blending with what the destination already holds changes its average.
   *
   * Both balances are locked through `lockPairs`, which orders them by `(item, warehouse)` — the
   * reason a transfer A→B and a concurrent B→A cannot deadlock.
   */
  async transfer(
    tem: EntityManager,
    demand: StockDemand,
    destWarehouseId: string,
  ): Promise<StockTxn[]> {
    if (!demand.lines.length) return [];

    const wanted = aggregateByPair(demand.lines);
    // Lock source and destination together, in one ordered pass.
    const allPairs = [
      ...wanted,
      ...wanted.map((p) => ({ itemId: p.itemId, warehouseId: destWarehouseId })),
    ];
    const locked = await this.balances.lockPairs(tem, allPairs);
    const written: StockTxn[] = [];

    for (const pair of wanted) {
      const source = locked.get(`${pair.itemId}:${pair.warehouseId}`)!;
      const dest = locked.get(`${pair.itemId}:${destWarehouseId}`)!;

      const outCost = this.balances.applyMovement(source, StockTxnType.TRANSFER_OUT, pair.qty);
      written.push(
        this.ledger.record(tem, {
          itemId: pair.itemId,
          warehouseId: pair.warehouseId,
          txnType: StockTxnType.TRANSFER_OUT,
          qty: pair.qty,
          unitCost: outCost,
          documentId: demand.documentId,
        }),
      );

      // Carry the source's cost across: the goods did not become more or less valuable in transit.
      const inCost = this.balances.applyMovement(
        dest,
        StockTxnType.TRANSFER_IN,
        pair.qty,
        outCost,
      );
      written.push(
        this.ledger.record(tem, {
          itemId: pair.itemId,
          warehouseId: destWarehouseId,
          txnType: StockTxnType.TRANSFER_IN,
          qty: pair.qty,
          unitCost: inCost,
          documentId: demand.documentId,
        }),
      );
    }
    await tem.flush();
    return written;
  }

  /**
   * Read a document's stock demand from its lines, using the warehouse the document names.
   *
   * Rejects a line whose item is not `is_stock_tracked`: a stock document that quietly ignored an
   * untracked line would approve a withdrawal that never happens. Item-less lines are rejected
   * for the same reason — there is nothing to take out of the warehouse.
   */
  async demandFor(
    tem: EntityManager,
    document: Document,
    warehouseId: string,
  ): Promise<StockDemand> {
    const lines = await tem.find(
      DocumentLine,
      { document: document.id },
      { populate: ['item'], orderBy: { lineNo: 'ASC' }, ...FILTER_OFF },
    );

    const demand: StockDemandLine[] = [];
    for (const line of lines) {
      if (!line.item) {
        throw new BadRequestException(
          `Line ${line.lineNo} has no item; a stock document must name an item on every line`,
        );
      }
      if (!line.item.isStockTracked) {
        throw new BadRequestException(
          `Line ${line.lineNo} names '${line.item.itemCode}', which is not stock-tracked`,
        );
      }
      if (Money.compare(line.qty, '0') <= 0) {
        throw new BadRequestException(`Line ${line.lineNo} must move a positive quantity`);
      }
      demand.push({
        itemId: line.item.id,
        warehouseId,
        qty: line.qty,
        lineNo: line.lineNo,
        documentLineId: line.id,
      });
    }
    return { documentId: document.id, lines: demand };
  }
}
