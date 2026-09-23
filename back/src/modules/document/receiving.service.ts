import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RequestContext } from '../../common/context/request-context';
import { StockTxnType } from '../../common/enums';
import { Money } from '../../common/money/money';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { orderPairs, StockBalanceService } from '../inventory/stock-balance.service';
import { StockLedgerService } from '../inventory/stock-ledger.service';
import { WarehouseService } from '../inventory/warehouse.service';
import { Document, DocumentLine } from './document.entities';
import type { ReceiveDto } from './dto/document.dto';

const FILTER_OFF = { filters: { company: false } } as const;

export interface ReceivedLineView {
  lineId: string;
  lineNo: number;
  qty: string;
  receivedQty: string;
  lineStatus: string;
  /** Set when this line also put stock into a warehouse. */
  stockedQty?: string;
  unitCost?: string;
}

/** One line's contribution to the warehouse, collected while lines are processed. */
interface StockIntake {
  itemId: string;
  qty: string;
  unitCost: string;
  documentLineId: string;
  lineNo: number;
}

/** Goods receipt: accumulate received_qty on a document's lines and advance line_status. */
@Injectable()
export class ReceivingService {
  constructor(
    private readonly scope: CompanyScopeService,
    // Optional: absent in unit tests that exercise receiving without inventory wired up. When
    // absent, receiving behaves exactly as it did before stock existed.
    @Optional() private readonly balances?: StockBalanceService,
    @Optional() private readonly ledger?: StockLedgerService,
    @Optional() private readonly warehouses?: WarehouseService,
    // Optional for the same reason: a unit test that receives without inventory emits nothing.
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  /** Derive line_status from received vs ordered qty. */
  private statusOf(receivedQty: string, orderedQty: string): string {
    if (Money.compare(receivedQty, '0') <= 0) return 'OPEN';
    if (Money.compare(receivedQty, orderedQty) >= 0) return 'RECEIVED';
    return 'PARTIAL';
  }

  /**
   * Record received quantities against the document's lines (company-scoped). Each line is
   * locked FOR UPDATE so concurrent receipts accumulate without lost updates; over-receipt
   * (received_qty above ordered qty) is rejected.
   *
   * When a warehouse is named, the same transaction also puts stock into it for every line whose
   * item is `is_stock_tracked`. Receipt and stock commit together deliberately: if the stock
   * write failed after `received_qty` advanced, matching would believe goods arrived that the
   * warehouse never saw.
   *
   * `received_qty` remains the quantity 3-way matching reads, tracked or not — this adds a
   * consequence to receiving, it does not change what receiving means.
   *
   * Writes no `budget_txn`. Budget was committed when the purchase document was submitted and is
   * actualized at payment; charging it again here would bill the same purchase twice (invariant 3).
   *
   * The `stock_txn` rows it writes are announced on `stock.moved` after the commit, the same way an
   * approved stock movement announces its own, so GL posting capitalizes the goods (Dr INVENTORY /
   * Cr GRNI). Without that the payment's GRNI debit — which assumes the receipt already credited it
   * — never clears, and the GL never learns the warehouse gained anything.
   */
  async receive(documentId: string, dto: ReceiveDto): Promise<ReceivedLineView[]> {
    const companyId = RequestContext.companyId()!;
    if (!dto.lines?.length) throw new BadRequestException('No receipt lines provided');

    // Only a type configured to receive takes a receipt. The action used to be open to every
    // document with lines, so receipts landed on requisitions and claims while matching went on
    // reading the PO — and the person then learned at the disbursement that nothing had arrived.
    const document = await this.scope
      .forActiveCompany()
      .findOne(Document, { id: documentId }, { populate: ['documentType'] });
    if (!document) throw new NotFoundException(`Document ${documentId} not found`);
    if (!document.documentType.receivesGoods) {
      throw new BadRequestException(
        `Document type ${document.documentType.code} does not receive goods; receipts are recorded on the type configured for it`,
      );
    }

    const stockEnabled = !!(dto.warehouseId && this.balances && this.ledger && this.warehouses);
    // Resolve the warehouse before the write transaction: one of another company, or a
    // deactivated one, must be a rejection rather than a silent write into the wrong place.
    const warehouseId = stockEnabled
      ? (await this.warehouses!.requireActive(dto.warehouseId!)).id
      : undefined;

    // The transaction runs on a company-bound EntityManager, not a raw one: `stock_balance` is a
    // CompanyScopedEntity whose filter needs its params bound, and the document-line work is
    // company-scoped anyway — so binding is strictly safer than not.
    const stockTxnIds: string[] = [];
    const received = await this.scope.forActiveCompany().transactional(async (tem: EntityManager) => {
      const out: ReceivedLineView[] = [];
      const intake: StockIntake[] = [];

      for (const input of dto.lines) {
        if (Money.compare(input.qty, '0') <= 0) {
          throw new BadRequestException(`Received qty must be positive for line ${input.lineId}`);
        }
        const line = await tem.findOne(
          DocumentLine,
          { id: input.lineId },
          {
            ...FILTER_OFF,
            lockMode: LockMode.PESSIMISTIC_WRITE,
            populate: ['document', 'item'],
          },
        );
        if (!line || line.document.id !== documentId || line.document.company.id !== companyId) {
          throw new NotFoundException(`Line ${input.lineId} not found on document ${documentId}`);
        }
        const newReceived = Money.add(line.receivedQty, input.qty);
        if (Money.compare(newReceived, line.qty) > 0) {
          throw new BadRequestException(
            `Over-receipt on line ${line.lineNo}: ${newReceived} would exceed ordered ${line.qty}`,
          );
        }
        line.receivedQty = newReceived;
        // Stamp WHEN, not just how much. Without it "received as at the 30th" is unanswerable for
        // any line that produces no stock_txn — which is every service and untracked consumable.
        line.lastReceivedAt = new Date();
        line.lineStatus = this.statusOf(newReceived, line.qty);

        const view: ReceivedLineView = {
          lineId: line.id,
          lineNo: line.lineNo,
          qty: line.qty,
          receivedQty: line.receivedQty,
          lineStatus: line.lineStatus,
        };

        if (warehouseId && line.item?.isStockTracked) {
          const unitCost = this.receiptUnitCost(line);
          intake.push({
            itemId: line.item.id,
            qty: input.qty,
            unitCost,
            documentLineId: line.id,
            lineNo: line.lineNo,
          });
          view.stockedQty = input.qty;
          view.unitCost = unitCost;
        }
        out.push(view);
      }

      if (warehouseId && intake.length) {
        // Replaced, not appended: a retried transaction must not announce ids it rolled back.
        stockTxnIds.length = 0;
        stockTxnIds.push(...(await this.putAway(tem, documentId, warehouseId, intake)));
      }

      await tem.flush();
      return out;
    });

    // Post-commit, mirroring the approval path: a GL failure must not roll back a receipt the
    // warehouse has already taken in. Stock stays correct while the GL is visibly incomplete.
    if (stockTxnIds.length) this.events?.emit('stock.moved', { stockTxnIds });
    return received;
  }

  /**
   * Receipt cost per unit, in the company base currency.
   *
   * Taken from the line's `budget_base_line_amount` — the base-currency amount already stamped at
   * the locked submit-time FX rate (invariant 6) — so a receipt never resolves a rate of its own.
   * The alternative, converting at today's rate, would value the same goods differently depending
   * on when the lorry arrived.
   *
   * Falls back to `base_line_amount` only if the budget basis is absent, and to zero for a free
   * line, which values it at nothing rather than refusing the receipt outright.
   */
  private receiptUnitCost(line: DocumentLine): string {
    const baseAmount = line.budgetBaseLineAmount ?? line.baseLineAmount;
    if (!baseAmount || Money.compare(line.qty, '0') <= 0) return '0';
    return Money.divide(baseAmount, line.qty);
  }

  /**
   * Put the receipt's lines into the warehouse: lock each affected balance in the fixed
   * `(item, warehouse)` order, re-average, and append a RECEIVE row per line.
   *
   * Locks are taken after the `document_line` locks above and in `orderPairs` sequence, so this
   * path takes them in the same order every other stock path does.
   */
  private async putAway(
    tem: EntityManager,
    documentId: string,
    warehouseId: string,
    intake: StockIntake[],
  ): Promise<string[]> {
    const pairs = orderPairs(intake.map((i) => ({ itemId: i.itemId, warehouseId })));
    const locked = await this.balances!.lockPairs(tem, pairs);

    // Applied per line, not per aggregated pair: two lines of the same item at different costs
    // must each blend into the average in turn, or the second cost would be lost.
    const written: string[] = [];
    for (const i of intake) {
      const balance = locked.get(`${i.itemId}:${warehouseId}`)!;
      const cost = this.balances!.applyMovement(balance, StockTxnType.RECEIVE, i.qty, i.unitCost);
      const txn = this.ledger!.record(tem, {
        itemId: i.itemId,
        warehouseId,
        txnType: StockTxnType.RECEIVE,
        qty: i.qty,
        unitCost: cost,
        documentId,
        documentLineId: i.documentLineId,
        remark: `goods receipt line ${i.lineNo}`,
      });
      written.push(txn.id);
    }
    return written;
  }
}
