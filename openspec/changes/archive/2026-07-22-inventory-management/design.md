## Context

The platform already contains a working, battle-tested pattern for exactly this problem shape:
`budget-control` maintains a scarce, company-scoped, concurrently-contended quantity through an
**insert-only ledger** (`budget_txn`) whose balance is *derived*, reserves under
`SELECT FOR UPDATE`, commits paired TRANSFER rows in one `em.transactional(...)`, and hooks the
document lifecycle at submit / approve / reject. `quota-management` repeats the same shape for
non-money allowances.

Inventory is the third instance of that pattern. This design deliberately mirrors budget rather
than inventing a parallel architecture, because every reviewer, test helper, and mental model in
the codebase is already tuned to it.

What exists today and must not break:
- `document_line.received_qty` + `line_status` drive **3-way matching** in `procurement-receiving`.
  This is commitment control, not stock. It stays exactly as-is.
- `item` is group-wide; `item_company.default_gl_account` is the per-company GL, validated against
  that company's chart of accounts.
- `journal_entry` is append-only and idempotent on `(company_id, source_type, source_id)`;
  system accounts resolve through `account_role`, never hardcoded codes.
- `document_type.post_action` is the single dispatch point for "what happens on full approval".

Constraints: PostgreSQL 15+, MikroORM, NestJS, every table scoped by `company_id`, all money and
cost as DECIMAL carried as string, and a permission-code guard on every endpoint.

## Goals / Non-Goals

**Goals:**
- Know `qty_on_hand`, `qty_reserved`, and `qty_available` per `(company, item, warehouse)`, derived
  from an append-only ledger that can be replayed to reproduce any balance.
- Value stock at moving weighted average per `(item, warehouse)`, with the consumed `unit_cost`
  stamped on each outbound row so history never needs recosting.
- Let goods issue, adjustment, and inter-warehouse transfer be **ordinary configured documents**
  that inherit workflow, delegation, no-self-approval, and the reject/cancel release hook.
- Capitalize purchase receipts into stock atomically with the existing `received_qty` update.
- Post perpetual, balanced, idempotent GL for every approved movement.
- Never let a stock movement touch `budget_txn`.

**Non-Goals:**
- FIFO / LIFO / standard costing, and any cost-variance accounting.
- Lot, serial, expiry, or bin-level tracking.
- Reorder points, min/max planning, MRP, or purchase suggestions.
- Physical-count / cycle-count sessions and count-variance approval.
- Landed cost allocation (freight, duty) onto receipt cost.
- Period-close valuation freeze or inventory aging reports.
- Inter-**company** stock transfer — forbidden by invariant 1, not deferred.

## Decisions

### D1. `stock_txn` is the truth; `stock_balance` is a derived, lockable projection

`stock_txn` is insert-only (invariant 2). `stock_balance` exists for two reasons only: it is the
row we take `PESSIMISTIC_WRITE` on, and it saves an aggregate scan on every read.

    qty_on_hand  = Σ RECEIVE + TRANSFER_IN + ADJUST_INCREASE
                 − Σ ISSUE  − TRANSFER_OUT − ADJUST_DECREASE
    qty_reserved = Σ RESERVE − Σ RELEASE − Σ ISSUE
    qty_available = qty_on_hand − qty_reserved

`RESERVE` and `RELEASE` move only `qty_reserved`; they never move `qty_on_hand` and never carry
cost. `ISSUE` is the conversion: it decrements `qty_on_hand` **and** discharges the matching
reservation — exactly as budget `ACTUAL` converts a `RESERVE` rather than double-charging
(invariant 3's ACTUAL rule, applied to units).

A `stock_balance` row is created lazily on first movement for a pair and is never deleted. A
rebuild-from-ledger check is a required test, not just documentation: it is the only thing that
proves the projection has not silently drifted.

*Alternative rejected:* balance-only, no ledger. Cheaper, but loses audit trail, makes "why is
this number wrong" unanswerable, and breaks invariant 2's spirit for the third scarce resource in
the system.

*Alternative rejected:* ledger-only, aggregate on read. Correct but gives us no row to lock, so
two concurrent issues both read "10 available" and both succeed. Advisory locks would work but
are invisible to reviewers; a real row is self-documenting.

### D2. Moving weighted average, recomputed only on inbound value

    new_avg = (qty_on_hand × avg_cost + inbound_qty × inbound_unit_cost)
              / (qty_on_hand + inbound_qty)

Applied on `RECEIVE`, `TRANSFER_IN`, `ADJUST_INCREASE`. Outbound rows read the current `avg_cost`,
stamp it on the `stock_txn.unit_cost`, and leave `avg_cost` unchanged — so issuing never moves the
unit cost, only the total value.

`avg_cost` is `decimal(15,6)` (finer than money's `15,2`) because it is a *rate*, not a posted
amount, and rounding it to 2 places lets error accumulate across many small receipts. Every GL
amount derived from it is rounded to the currency's places at posting time, and the rounding
residual is absorbed into the inventory line so the entry still balances to the cent.

Edge case that must be specified, not discovered: when `qty_on_hand` is 0 (or would divide by
zero), an inbound movement **sets** `avg_cost` to the inbound unit cost rather than averaging.

*Alternative rejected:* FIFO layers. More faithful, but needs a `stock_layer` table, layer-consume
logic, partial-layer accounting, and layer repair after adjustment — roughly triple the surface
for a first inventory slice. The seam is isolated in one `CostingStrategy` so FIFO can be added
later without reshaping `stock_txn`.

### D3. Movements are documents, driven by `post_action` — receipts are not

Issue / adjust / transfer become `document_type` rows with `post_action` of `ISSUE_STOCK`,
`ADJUST_STOCK`, `TRANSFER_STOCK`. They inherit workflow routing, `form_template`, `approval_log`,
delegation, no-self-approval, and the reject/cancel release hook at zero marginal cost, and they
satisfy invariant 7 — the engine branches on configuration, not on a hardcoded type code.

**Receipts are the deliberate exception.** `procurement-receiving` already models a goods receipt
as an action *against a PO's lines*, with partial receipt, over-receipt rejection, and row-locked
accumulation. Making receipt a second, parallel document type would fork `received_qty` ownership
and put 3-way matching at risk. Instead the existing receive endpoint gains a `warehouse_id` and,
inside its **existing** transaction, writes the `RECEIVE` rows.

Non-PO inbound (opening balances, customer returns, found stock) is an `ADJUST_STOCK` document
with a positive quantity — it needs approval and a reason, which is exactly what a document gives.

*Alternative rejected:* a `RECEIVE_STOCK` post-action and a GR document type. Cleaner symmetry,
but it duplicates receiving and forces a migration of live `received_qty` semantics.

### D4. Reserve → issue → release, hooked at the same three lifecycle points as budget

| Lifecycle event | Budget today | Stock (this change) |
|---|---|---|
| Submit | `RESERVE` | `RESERVE`, after an availability check |
| Full approval | `ACTUAL` | `ISSUE` (+ GL posting) |
| Reject / cancel | `RELEASE` | `RELEASE` |

Availability is enforced **at submit**, when the reservation is taken — not at approval. Blocking
at approval would mean a document sails through four approvers and dies at the last step, and the
approver gets blamed for a shortage they did not cause. Reserving at submit makes the shortage
visible to the requester immediately and makes the reservation real for everyone behind them in
the queue.

A reject or cancel at *any* state that holds a reservation releases it (invariant 4/5). The
release is idempotent: a document already released is a no-op, never a second `RELEASE` row.

### D5. Perpetual GL, accounts resolved through `account_role`

`account_role_type` gains `INVENTORY`, `INVENTORY_ADJUSTMENT`, `INVENTORY_IN_TRANSIT`.

| Movement | Debit | Credit |
|---|---|---|
| Receipt (PO) | `INVENTORY` | GRNI / the PO's accrual side |
| Issue | item's `item_company.default_gl_account` | `INVENTORY` |
| Adjust increase | `INVENTORY` | `INVENTORY_ADJUSTMENT` |
| Adjust decrease | `INVENTORY_ADJUSTMENT` | `INVENTORY` |
| Transfer | `INVENTORY` (dest) | `INVENTORY` (source) |

Transfer between two warehouses of one company nets to zero in GL when both map to the same
`INVENTORY` account; the design still posts it (as a zero-net two-line entry, or skips it when
source and destination resolve to the same account) so the ledger and the GL never disagree about
whether an event happened. `INVENTORY_IN_TRANSIT` is reserved for a future multi-step transfer and
is unused in this change.

Posting reuses the existing contract verbatim: idempotent on `(company_id, source_type,
source_id)` with `source_type = 'STOCK_TXN'`, balanced lines, and — critically — **a missing or
inactive `account_role` mapping fails the posting and is logged, without crashing the movement**.
That is already how payment posting behaves, and diverging would be a nasty surprise.

*Alternative rejected:* periodic (post at period close). Less code, but leaves the balance sheet
wrong between closes, which defeats the point of asking for GL at all.

### D6. Stock movements never write `budget_txn`

Stated explicitly because it is the most likely way this change breaks invariant 3. Budget is
committed when the PR/PO is submitted and actualized at payment. If a receipt also cut budget, the
same purchase would be charged twice. A receipt capitalizes an asset in GL; an issue expenses it.
Neither is a budget event. The only interaction is that the receipt endpoint touches both
`received_qty` (matching) and `stock_txn` (stock) in one transaction.

### D7. `is_stock_tracked` on the group `item`, not on `item_company`

Whether something is a physical good is a property of the thing, not of a company's relationship
to it. Per-company control already exists via `item_company.is_active`. Defaults to `false` so no
existing item, document, or receipt changes behavior on deploy.

## Transaction boundaries and locking

Every sequence below is one `em.transactional(...)`. `stock_balance` rows are the lock targets.

**Submit an issue document** — `ISSUE_STOCK` / `TRANSFER_STOCK`
1. Resolve document, warehouse, and lines; reject any non-`is_stock_tracked` item early.
2. **Aggregate lines by `(item, warehouse)` before locking** — a document with the same item on
   two lines must take one lock and check the summed quantity, or two lines of 6 each pass
   individually against 10 available and oversell.
3. `SELECT … FOR UPDATE` each `stock_balance` row **ordered by `(item_id, warehouse_id)`** — a
   fixed global order, because a transfer locks two rows and unordered acquisition deadlocks.
4. Check `qty_available >= requested` for every pair. Any shortfall rejects the whole submit; no
   partial reservation is ever written.
5. Insert `RESERVE` rows; bump `qty_reserved`.
6. Budget/quota reservation, document numbering, and FX locking proceed as they do today, inside
   the same transaction.

**Full approval** — post-action dispatch
1. Lock the same `stock_balance` rows in the same order.
2. Insert `ISSUE` rows stamped with the current `avg_cost`; decrement `qty_on_hand` and
   `qty_reserved`; recompute `total_value`.
3. For `TRANSFER_STOCK`, insert the paired `TRANSFER_OUT` and `TRANSFER_IN` **in the same
   transaction** (never one without the other), carrying the source's `avg_cost` as the
   destination's inbound unit cost, then re-average the destination.
4. Build and insert the `journal_entry` + lines. A posting failure is logged and does not roll
   back the stock movement — matching the existing payment-posting contract.

**Goods receipt** — inside the existing receive transaction
1. Lock the `document_line` rows (as today) and the target `stock_balance` rows, `document_line`
   first, then balances in `(item, warehouse)` order.
2. Advance `received_qty` / `line_status` exactly as today.
3. For tracked items, insert `RECEIVE` at `budget_base_line_amount / qty` and re-average.
4. Post GL.

**Reject / cancel**
1. Lock the reserved pairs; insert `RELEASE`; decrement `qty_reserved`. Idempotent — a document
   with no live reservation writes nothing.

Concurrency tests are required for: two concurrent issues against insufficient stock (exactly one
succeeds), concurrent receipts re-averaging (final `avg_cost` matches the serial result),
two transfers in opposite directions between the same pair of warehouses (no deadlock), and
duplicate release (one `RELEASE` row).

## Slices

Each is independently applyable and leaves the system green.

1. **Foundation** — `warehouse` master, `stock_txn`, `stock_balance`, `item.is_stock_tracked`,
   permission codes, read surfaces (balances, ledger), migrations. No movement yet.
2. **Issue & release** — `ISSUE_STOCK` post-action, `requires_warehouse`, submit-time reservation,
   approval-time issue, reject/cancel release, weighted-average consumption. Concurrency tests.
3. **Receipt hook** — warehouse on goods receipt, `RECEIVE` + re-averaging inside the existing
   transaction, 3-way matching regression tests.
4. **Adjust & transfer** — `ADJUST_STOCK` and `TRANSFER_STOCK` post-actions, paired transfer rows.
5. **GL posting** — `account_role` extension and perpetual posting for all movement types.
6. **Web** — `web-inventory`: on-hand by warehouse, per-item ledger with running balance,
   warehouse config, and the three document forms.

## Risks / Trade-offs

- **`stock_balance` drifts from `stock_txn`** → the projection is only ever written inside the same
  locked transaction as the ledger insert, never by a separate job; a rebuild-from-ledger test
  asserts equality, and a maintenance recompute endpoint (gated by `INV_MANAGE`) exists as the
  repair path.
- **Negative stock under concurrency** → availability is checked *after* taking
  `PESSIMISTIC_WRITE`, never before, and lines are aggregated per pair before the check.
- **Deadlock on transfer** → all balance locks are acquired in a fixed `(item_id, warehouse_id)`
  order in every code path, including the two-warehouse transfer.
- **Double-charging the budget** → D6 makes it an explicit spec requirement that stock movements
  write no `budget_txn`, with a test asserting a receipt produces zero budget rows.
- **Rounding drift in `avg_cost`** → cost held at 6 decimals, GL rounded at posting, residual
  absorbed into the inventory line so entries always balance.
- **Weighted average is wrong for some businesses** → accepted for this change; the costing seam
  is a single strategy interface, and `stock_txn.unit_cost` already records what was actually
  consumed, so a future FIFO migration has the history it needs.
- **A company configures a warehouse but forgets `account_role`** → posting fails and is logged,
  the movement still happens, and stock is correct while GL is visibly incomplete — the same
  failure mode operators already know from payment posting.
- **Reserving at submit surprises requesters** → stock can be held for a long time by a document
  stuck in approval. Accepted; the ledger makes every reservation attributable to a document, and
  cancel releases it. A reservation-aging report is future work.
