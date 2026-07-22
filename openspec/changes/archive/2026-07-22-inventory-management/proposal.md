## Why

The ERP tracks what was *ordered*, *received on paper*, and *paid for*, but never what is
physically **on hand**. `document_line.received_qty` exists only to gate 3-way matching before
disbursement — it answers "may we pay yet?", not "what do we have, where is it, and what did it
cost?". Nothing in the 56 capabilities or the 64-table DBML models a warehouse, a stock balance,
or a goods issue, so a receipt of 100 units and a withdrawal of 40 leave no trace of the 60 that
remain, and the balance sheet carries no inventory asset.

This change adds stock as a first-class, company-scoped, append-only ledger — mirroring exactly
the shape `budget-control` already proved: an insert-only `budget_txn` with derived balances,
paired TRANSFER rows in one transaction, and pessimistic locking on the reservation path.

## What Changes

**Stock ledger and derived balances**
- New `warehouse` master, scoped by `company_id`, with per-company codes. Stock never crosses a
  company boundary — there is no inter-company transfer, only intra-company (invariant 1).
- New **append-only** `stock_txn` ledger (insert-only, never UPDATE/DELETE — invariant 2), with
  movement types `RESERVE` / `ISSUE` / `RELEASE` / `RECEIVE` / `ADJUST_INCREASE` /
  `ADJUST_DECREASE` / `TRANSFER_OUT` / `TRANSFER_IN`. Corrections are new rows.
- New `stock_balance` as a **locking and derivation row** per `(company, item, warehouse)`
  carrying `qty_on_hand`, `qty_reserved`, `avg_cost`, `total_value`. It is a maintained
  projection of the ledger, never an independently authored number — a rebuild from `stock_txn`
  MUST reproduce it exactly (invariant 3).
- `qty_available = qty_on_hand − qty_reserved` is what an issue may draw on.

**Weighted-average costing**
- `avg_cost` per `(item, warehouse)` is recomputed **only on inbound value** (`RECEIVE`,
  `TRANSFER_IN`, `ADJUST_INCREASE`): `new_avg = (old_value + inbound_value) / (old_qty + qty)`.
- Outbound movements consume at the `avg_cost` prevailing at that moment and stamp that
  `unit_cost` onto the `stock_txn` row, so the ledger is self-describing and never needs
  recosting. Cost is DECIMAL end to end, carried as string — never a JS number.

**Movements ride the document engine** (invariant 7 — configuration, not per-type code)
- New `document_type.post_action` values `ISSUE_STOCK`, `ADJUST_STOCK`, `TRANSFER_STOCK`, so
  goods issue, stock adjustment, and inter-warehouse transfer are ordinary documents that inherit
  workflow routing, `form_template`, `approval_log`, delegation, and no-self-approval for free.
- New `document_type.requires_warehouse` flag; a document of such a type carries a warehouse
  (and, for transfers, a destination warehouse) validated to the active company.
- **Reserve → actual → release applies to stock, not just money** (invariant 4): an issue
  document `RESERVE`s stock at submit, converts to `ISSUE` at final approval, and reject/cancel
  ALWAYS auto-`RELEASE`s — the same lifecycle hook that already releases budget and quota.

**Purchase receipts feed the warehouse**
- The existing `DOC_RECEIVE` goods-receipt action gains a target warehouse and, for stock-tracked
  items, writes a `RECEIVE` row in the same transaction that advances `received_qty`. Receipt unit
  cost comes from the PO line's `budget_base_line_amount / qty` — the base-currency amount already
  stamped at the locked submit-time FX rate (invariant 6). 3-way matching semantics are untouched.

**Perpetual GL posting**
- Every approved stock movement posts a balanced `journal_entry` through the existing engine,
  idempotent on `(source_type, source_id)`. Issue debits the item's per-company expense GL and
  credits inventory; receipt debits inventory; adjustments hit an adjustment account.
- Accounts resolve through `account_role`, never hardcoded codes: new roles `INVENTORY`,
  `INVENTORY_ADJUSTMENT`, `INVENTORY_IN_TRANSIT`. A missing mapping fails the posting and is
  logged — it does not crash the movement (matching the existing posting contract).

**Master data**
- `item` gains `is_stock_tracked` (a property of the good itself, so group-level). Only tracked
  items move stock; services and free-text lines are unaffected, so every existing document type
  keeps working unchanged.

**Permissions** — new codes `INV_VIEW`, `INV_ISSUE`, `INV_ADJUST`, `INV_TRANSFER`, `INV_MANAGE`,
authorized by code, never role name (invariant 5).

**Not in scope** (deliberately deferred): FIFO/standard costing, lot/serial tracking, bin
locations, reorder points, physical-count sessions, landed cost, and period-close valuation
freeze. The costing method is a single documented seam so FIFO can be added later without
reshaping the ledger.

## Capabilities

### New Capabilities
- `inventory`: warehouse master, the append-only `stock_txn` ledger and its derived balances,
  weighted-average costing, the four stock post-actions, reserve/issue/release lifecycle,
  perpetual GL posting, and the company-scoped read surfaces for balances and movement history.
- `web-inventory`: Vue admin area — on-hand by warehouse, per-item stock ledger with running
  balance, warehouse configuration, and the issue/adjust/transfer document forms.

### Modified Capabilities
- `document-engine`: `post_action` gains `ISSUE_STOCK` / `ADJUST_STOCK` / `TRANSFER_STOCK`;
  `document_type` gains `requires_warehouse`; the submit lifecycle reserves stock and the
  reject/cancel path releases it alongside budget and quota.
- `procurement-receiving`: a goods receipt targets a warehouse and posts stock for tracked items
  atomically with the `received_qty` update; 3-way matching behavior is unchanged.
- `gl-journal`: adds stock movements as a posting source and the three inventory `account_role`
  entries to the config-driven role map.
- `master-data`: `item` gains `is_stock_tracked`, and the item registry states which items are
  stockable.

## Impact

**Data model** — new tables `warehouse`, `stock_txn`, `stock_balance`; new columns
`item.is_stock_tracked`, `document_type.requires_warehouse`, `document.warehouse_id` +
`document.dest_warehouse_id`; extended `account_role_type` enum. All new tables carry `company_id`
and are indexed on the company-scoped access paths.

**Concurrency** — the issue path reserves under `LockMode.PESSIMISTIC_WRITE` on `stock_balance`
to prevent negative stock under concurrent submits; receipt re-averaging takes the same lock so
`avg_cost` cannot be computed from a stale read. Paired `TRANSFER_OUT` + `TRANSFER_IN` commit in
one `em.transactional(...)`, locking both balance rows in a deterministic order to avoid deadlock.
Every one of these paths needs a concurrency test.

**Build order** — `inventory` depends on `master-data` (items), `document-engine` and
`approval-workflow` (post-actions and lifecycle hooks), `chart-of-accounts` + `gl-journal`
(posting), and `rbac`. It slots after `approval-workflow`:
`… → document-engine → approval-workflow → inventory → notifications`.

**Backward compatibility** — additive. `is_stock_tracked` and `requires_warehouse` both default
false, so existing document types, items, receipts, and matching behave exactly as before until a
company opts in by configuring a warehouse and marking items stockable.

**Risk** — the sharpest edge is double-counting: a purchase receipt both cuts budget (via the
existing PO/disbursement chain) and now capitalizes inventory. These are different ledgers with
different meanings — budget is commitment control, GL is accounting — and the design must state
that a stock movement never writes `budget_txn`, so a receipt cannot charge the budget twice.
