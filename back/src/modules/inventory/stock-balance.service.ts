import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { StockTxnType } from '../../common/enums';
import { Money } from '../../common/money/money';
import { paginate, withSearch, type Paginated } from '../../common/pagination/pagination';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { COSTING_STRATEGY, valueOf, WeightedAverageCosting, type CostingStrategy } from './costing.strategy';
import { Item } from '../master-data/master-data.entities';
import { Company } from '../multi-company/multi-company.entities';
import { StockBalance, StockTxn, Warehouse } from './inventory.entities';
import { onHandDelta, reservedDelta } from './stock-ledger.service';

/**
 * The company entity filter is disabled on queries that run on a CALLER-SUPPLIED EntityManager.
 *
 * Callers hand over whatever they hold — the submit transaction, the approval transaction, a
 * plain fork — and most are not bound to the active company, which makes the filter throw
 * "No arguments provided for filter 'company'". Every such query below already carries an
 * explicit `company: companyId` predicate, so the filter is redundant defence, not the guard.
 * Disabling it here trades a duplicate check for one that cannot depend on how the caller built
 * its EntityManager.
 */
const FILTER_OFF = { filters: { company: false } } as const;
import type { StockOnHandQueryDto } from './dto/stock.dto';

/**
 * Quantity scale, matching `numeric(15,4)`. Postgres returns a stored quantity as '10.0000' while
 * an in-memory sum produces '10'; both are the same number, but a read surface that emits both
 * shapes side by side makes the client's formatting job harder for no reason. Every quantity this
 * service returns is normalised to this scale.
 */
export const QTY_SCALE = 4;

/** A pair to lock. Callers pass these; this service imposes the ordering. */
export interface StockPair {
  itemId: string;
  warehouseId: string;
}

/** On-hand row as the read surface returns it — every figure a decimal string. */
export interface StockOnHandRow {
  itemId: string;
  itemCode: string;
  itemName: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  qtyOnHand: string;
  qtyReserved: string;
  qtyAvailable: string;
  avgCost: string;
  totalValue: string;
}

/** Quantities a replay of the ledger produces for one pair. */
export interface DerivedQuantities {
  qtyOnHand: string;
  qtyReserved: string;
}

/**
 * Sort pairs into a single global order — `(itemId, warehouseId)` ascending — so every code path
 * acquires `stock_balance` locks in the same sequence.
 *
 * This is what stops a transfer deadlocking: a transfer from A to B and one from B to A each lock
 * two rows, and without a fixed order they can take them in opposite sequences and wait on each
 * other forever.
 */
export function orderPairs(pairs: StockPair[]): StockPair[] {
  return [...pairs].sort((a, b) =>
    a.itemId === b.itemId
      ? a.warehouseId.localeCompare(b.warehouseId)
      : a.itemId.localeCompare(b.itemId),
  );
}

/** Collapse duplicate pairs, summing their quantities. */
export function aggregateByPair<T extends StockPair & { qty: string }>(
  lines: T[],
): Array<StockPair & { qty: string }> {
  const byKey = new Map<string, StockPair & { qty: string }>();
  for (const line of lines) {
    const key = `${line.itemId}:${line.warehouseId}`;
    const existing = byKey.get(key);
    if (existing) existing.qty = Money.add(existing.qty, line.qty);
    else byKey.set(key, { itemId: line.itemId, warehouseId: line.warehouseId, qty: line.qty });
  }
  return [...byKey.values()];
}

/**
 * `stock_balance` is a projection of `stock_txn`, not an independently authored number: replaying
 * the ledger must reproduce it exactly (invariant 3). It exists for two reasons only — it is the
 * row taken FOR UPDATE before availability is checked or cost re-averaged, and it saves an
 * aggregate scan on every read.
 *
 * Balances are written only inside the same transaction as the ledger rows they reflect, never by
 * a background job.
 */
@Injectable()
export class StockBalanceService {
  constructor(
    private readonly scope: CompanyScopeService,
    /**
     * Swap the provider bound to COSTING_STRATEGY to change costing method; nothing else in the
     * ledger has to move. `@Optional()` keeps the default so a unit test can construct this
     * service with nothing but a scope.
     */
    @Optional()
    @Inject(COSTING_STRATEGY)
    private readonly costing: CostingStrategy = new WeightedAverageCosting(),
  ) {}

  /**
   * Run `work` in one transaction on an EntityManager already bound to the active company.
   *
   * Every stock write must start here rather than from a raw EntityManager: the `company` entity
   * filter needs its params bound, and a transaction forked from an unbound EM would fail — or,
   * worse under a future filter change, read across companies. Making the correct entry point the
   * only convenient one is cheaper than remembering the rule at each call site.
   */
  transactional<T>(work: (tem: EntityManager) => Promise<T>): Promise<T> {
    return this.scope.forActiveCompany().transactional((tem) => work(tem as EntityManager));
  }

  /** Available = on-hand minus what submitted-but-unfinished documents are holding. */
  static available(balance: StockBalance): string {
    return Money.round(Money.subtract(balance.qtyOnHand, balance.qtyReserved), QTY_SCALE);
  }

  /**
   * Lock the given pairs FOR UPDATE, creating any balance row that does not exist yet, and return
   * them keyed by `itemId:warehouseId`.
   *
   * Locks are always taken in `orderPairs` sequence. Availability must be evaluated AFTER this
   * returns, never before — checking first and locking second is exactly how two concurrent
   * issues both see "10 available" and both succeed.
   */
  async lockPairs(
    tem: EntityManager,
    pairs: StockPair[],
  ): Promise<Map<string, StockBalance>> {
    const companyId = RequestContext.companyId()!;
    const locked = new Map<string, StockBalance>();

    for (const pair of orderPairs(pairs)) {
      const key = `${pair.itemId}:${pair.warehouseId}`;
      if (locked.has(key)) continue;

      let balance = await tem.findOne(
        StockBalance,
        { company: companyId, item: pair.itemId, warehouse: pair.warehouseId },
        { lockMode: LockMode.PESSIMISTIC_WRITE, ...FILTER_OFF },
      );

      if (!balance) {
        // First movement for this pair. Create and flush so the row exists (and is locked by our
        // own insert) before anything reads it — the unique constraint makes a concurrent
        // duplicate a constraint error rather than a second lockable row.
        balance = tem.create(StockBalance, {
          company: tem.getReference(Company, companyId),
          item: tem.getReference(Item, pair.itemId),
          warehouse: tem.getReference(Warehouse, pair.warehouseId),
          qtyOnHand: '0',
          qtyReserved: '0',
          avgCost: '0',
          totalValue: '0',
          updatedAt: new Date(),
        });
        tem.persist(balance);
        await tem.flush();
      }

      locked.set(key, balance);
    }

    return locked;
  }

  /**
   * Apply a movement's quantity effect to an already-locked balance row. Quantity only — used
   * directly where no value moves (RESERVE / RELEASE) and by `applyMovement` underneath.
   */
  applyQuantity(balance: StockBalance, txnType: StockTxnType, qty: string): void {
    balance.qtyOnHand = Money.add(balance.qtyOnHand, onHandDelta(txnType, qty));
    balance.qtyReserved = Money.add(balance.qtyReserved, reservedDelta(txnType, qty));
    balance.updatedAt = new Date();
  }

  /**
   * Apply a movement to a locked balance — cost first, then quantity, then revalue — and return
   * the unit cost the movement actually moved at, for stamping onto its `stock_txn` row.
   *
   * The ordering matters and is why this is one call rather than two: the weighted-average
   * formula divides by the quantity BEFORE the inbound is added, so re-averaging after
   * incrementing `qtyOnHand` would count the new units twice and understate the new cost. Making
   * the correct order the only available order removes the chance of getting it wrong at a call
   * site.
   *
   * Returns undefined for RESERVE/RELEASE: they move availability, not value, so their ledger
   * rows carry no cost.
   */
  applyMovement(
    balance: StockBalance,
    txnType: StockTxnType,
    qty: string,
    inboundUnitCost?: string,
  ): string | undefined {
    const movesValue = onHandDelta(txnType, qty) !== '0';
    if (!movesValue) {
      this.applyQuantity(balance, txnType, qty);
      return undefined;
    }

    const isInbound = Money.compare(onHandDelta(txnType, qty), '0') > 0;
    let effectiveCost: string;

    if (isInbound) {
      if (inboundUnitCost === undefined) {
        throw new Error(`An inbound ${txnType} needs a unit cost`);
      }
      // Re-average against the balance as it stands, before the quantity moves.
      balance.avgCost = this.costing.costAfterInbound(balance, qty, inboundUnitCost);
      effectiveCost = inboundUnitCost;
    } else {
      // Outbound consumes at the prevailing average and leaves it unchanged.
      effectiveCost = this.costing.costToConsume(balance);
    }

    this.applyQuantity(balance, txnType, qty);
    balance.totalValue = valueOf(balance.qtyOnHand, balance.avgCost);
    return effectiveCost;
  }

  /** On-hand for the active company, optionally narrowed to one warehouse or item. */
  async onHand(q: StockOnHandQueryDto): Promise<Paginated<StockOnHandRow>> {
    const companyId = RequestContext.companyId()!;
    const where: Record<string, unknown> = { company: companyId };
    if (q.warehouseId) where.warehouse = q.warehouseId;
    if (q.itemId) where.item = q.itemId;

    const page = await paginate(
      this.scope.forActiveCompany(),
      StockBalance,
      // Searched by what the row shows — the item's code and name — narrowing the company-scoped
      // predicate (and any warehouse/item filter already applied above), never replacing it.
      withSearch<StockBalance>(where as never, q.search, ['item.itemCode', 'item.name']),
      { populate: ['item', 'warehouse'], orderBy: { id: 'ASC' } },
      q,
    );

    return {
      ...page,
      items: page.items.map((b) => ({
        itemId: b.item.id,
        itemCode: b.item.itemCode,
        itemName: b.item.name,
        warehouseId: b.warehouse.id,
        warehouseCode: b.warehouse.code,
        warehouseName: b.warehouse.name,
        qtyOnHand: Money.round(b.qtyOnHand, QTY_SCALE),
        qtyReserved: Money.round(b.qtyReserved, QTY_SCALE),
        qtyAvailable: StockBalanceService.available(b),
        avgCost: b.avgCost,
        totalValue: b.totalValue,
      })),
    };
  }

  /**
   * Replay `stock_txn` for one pair and return the quantities it implies. The proof that the
   * projection has not drifted — and the basis of the repair path.
   */
  async deriveFromLedger(itemId: string, warehouseId: string): Promise<DerivedQuantities> {
    const companyId = RequestContext.companyId()!;
    const rows = await this.scope.forActiveCompany().find(StockTxn, {
      company: companyId,
      item: itemId,
      warehouse: warehouseId,
    });
    const summed = rows.reduce<DerivedQuantities>(
      (acc, txn) => ({
        qtyOnHand: Money.add(acc.qtyOnHand, onHandDelta(txn.txnType, txn.qty)),
        qtyReserved: Money.add(acc.qtyReserved, reservedDelta(txn.txnType, txn.qty)),
      }),
      { qtyOnHand: '0', qtyReserved: '0' },
    );
    // Normalised so a replay can be compared to the stored projection as a string, not just
    // numerically — the drift check is only useful if the two are directly comparable.
    return {
      qtyOnHand: Money.round(summed.qtyOnHand, QTY_SCALE),
      qtyReserved: Money.round(summed.qtyReserved, QTY_SCALE),
    };
  }

  /**
   * Rebuild a balance's quantities from its ledger. The repair path for a projection that has
   * drifted — gated by `INV_MANAGE` at the controller, because it rewrites a number the rest of
   * the system trusts.
   *
   * Deliberately does NOT recompute `avg_cost`: weighted average is path-dependent, so replaying
   * it needs every historical inbound cost in order, and a receipt whose cost was later corrected
   * would silently re-derive a different figure than the one already posted to the GL. Quantities
   * are reconstructible; the running average is history.
   */
  async recompute(itemId: string, warehouseId: string): Promise<StockBalance> {
    const companyId = RequestContext.companyId()!;
    return this.transactional(async (tem) => {
      const balance = await tem.findOne(
        StockBalance,
        { company: companyId, item: itemId, warehouse: warehouseId },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (!balance) throw new NotFoundException('Stock balance not found');

      const derived = await this.deriveFromLedger(itemId, warehouseId);
      balance.qtyOnHand = derived.qtyOnHand;
      balance.qtyReserved = derived.qtyReserved;
      balance.totalValue = Money.round(Money.multiply(derived.qtyOnHand, balance.avgCost), 2);
      balance.updatedAt = new Date();
      return balance;
    });
  }
}
