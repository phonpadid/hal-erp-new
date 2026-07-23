/**
 * Permission CODES for the inventory capability (invariant 5: authorize on codes, never on role
 * names — role names are per-company labels and may collide across companies).
 *
 * Split by what the holder can actually do to stock rather than lumped into one INV_MANAGE:
 * issuing goods, writing off a shortage, and moving stock between warehouses are different
 * authorities in most organisations, and a warehouse clerk who may issue is rarely the person
 * who may adjust a count discrepancy away.
 */
export const InventoryPermissions = {
  INV_VIEW: 'INV_VIEW', // read on-hand balances and movement history
  INV_ISSUE: 'INV_ISSUE', // raise a goods-issue document
  INV_ADJUST: 'INV_ADJUST', // raise a stock adjustment
  INV_TRANSFER: 'INV_TRANSFER', // raise an inter-warehouse transfer
  INV_MANAGE: 'INV_MANAGE', // administer warehouses and run the balance recompute
} as const;
