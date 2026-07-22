import { Injectable } from '@nestjs/common';
import { Money } from '../../common/money/money';

/** Cost scale — 6 decimals, matching `stock_balance.avg_cost` / `stock_txn.unit_cost`. */
export const COST_SCALE = 6;

/** Value scale — 2 decimals, the posted-amount scale `total_value` uses. */
export const VALUE_SCALE = 2;

/** The subset of a balance costing cares about, so the strategy stays testable without an ORM. */
export interface CostableBalance {
  qtyOnHand: string;
  avgCost: string;
}

/**
 * DI token for the costing strategy.
 *
 * `CostingStrategy` is an interface, so it does not exist at runtime — Nest would see `Object` as
 * the parameter type and fail to resolve it. A token makes the seam real: swapping weighted
 * average for FIFO becomes a one-line change in the module's providers.
 */
export const COSTING_STRATEGY = Symbol('CostingStrategy');

/**
 * How stock is valued. The single seam between the ledger and a costing method.
 *
 * Weighted average is what this change implements; FIFO would replace this interface without
 * reshaping `stock_txn`, because every outbound row already records the `unit_cost` it actually
 * consumed. History is self-describing, so a later method change does not have to recost the past.
 */
export interface CostingStrategy {
  /**
   * New average cost after an inbound movement of `qty` at `unitCost`, given the balance BEFORE
   * the quantity is applied. Returns the cost only — the caller owns the balance.
   */
  costAfterInbound(balance: CostableBalance, qty: string, unitCost: string): string;

  /** Cost per unit an outbound movement consumes at, given the balance before it is applied. */
  costToConsume(balance: CostableBalance): string;
}

/**
 * Moving weighted average, recomputed only on inbound value:
 *
 *     new_avg = (qty_on_hand × avg_cost + inbound_qty × inbound_unit_cost)
 *               / (qty_on_hand + inbound_qty)
 *
 * Outbound movements consume at the prevailing average and leave it unchanged — issuing moves
 * total value, never the unit cost.
 */
@Injectable()
export class WeightedAverageCosting implements CostingStrategy {
  costAfterInbound(balance: CostableBalance, qty: string, unitCost: string): string {
    const currentQty = balance.qtyOnHand;
    const newQty = Money.add(currentQty, qty);

    // Empty (or, defensively, a balance that would divide by zero): the inbound cost IS the
    // average. Averaging against nothing is not a smaller number, it is undefined — so this is a
    // set, not a weighted mean, and it is the case that occurs on every item's first receipt.
    if (Money.compare(currentQty, '0') <= 0 || Money.compare(newQty, '0') === 0) {
      return Money.round(unitCost, COST_SCALE);
    }

    const currentValue = Money.multiply(currentQty, balance.avgCost);
    const inboundValue = Money.multiply(qty, unitCost);
    const blended = Money.divide(Money.add(currentValue, inboundValue), newQty);
    return Money.round(blended, COST_SCALE);
  }

  costToConsume(balance: CostableBalance): string {
    return Money.round(balance.avgCost, COST_SCALE);
  }
}

/** Total value implied by a quantity at a unit cost, at the posted-amount scale. */
export function valueOf(qty: string, avgCost: string): string {
  return Money.round(Money.multiply(qty, avgCost), VALUE_SCALE);
}
