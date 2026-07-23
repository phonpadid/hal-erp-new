> Slices 1–6 map to the slices in `design.md`. Each slice ends green and is independently
> applyable. Mirror `back/src/modules/budget/` throughout — it is the proven shape for a
> company-scoped, append-only, pessimistically-locked ledger.

## 1. Foundation — warehouse master and the stock ledger

- [x] 1.1 Add `warehouse`, `stock_txn`, `stock_balance` to `erp_approval_system.dbml` with Thai
      column notes and indexes matching the existing style: `warehouse` unique on
      `(company_id, code)`; `stock_txn` indexed on `(company_id, item_id, warehouse_id)` and
      `document_id`; `stock_balance` unique on `(company_id, item_id, warehouse_id)`. Add
      `item.is_stock_tracked` (default false).
- [x] 1.2 Create `back/src/modules/inventory/inventory.entities.ts` with MikroORM entities for the
      three tables. `qty*` columns are `decimal(15,4)`, `unit_cost`/`avg_cost` are
      `decimal(15,6)`, `total_value` is `decimal(15,2)` — all mapped as type `'decimal'` and
      typed as `string`, never `number`.
- [x] 1.3 Add `is_stock_tracked` to the `Item` entity in `back/src/modules/master-data/`.
- [x] 1.4 Write the migration under `back/src/migrations/` creating the three tables and the
      `item.is_stock_tracked` column, all additive and defaulting so existing rows are untouched.
- [x] 1.5 Add `back/src/modules/inventory/permissions.ts` with `INV_VIEW`, `INV_ISSUE`,
      `INV_ADJUST`, `INV_TRANSFER`, `INV_MANAGE`, following the shape of
      `back/src/modules/budget/permissions.ts`, and seed the codes into the permission catalog.
- [x] 1.6 Implement `warehouse.service.ts`: list/get/create/update/deactivate, every query filtered
      by active company first, duplicate `(company_id, code)` surfaced as a conflict, deactivate
      by setting `is_active = false` and never deleting.
- [x] 1.7 Implement `stock-balance.service.ts`: read on-hand for a company (per item/warehouse,
      with `qty_available` derived), and a `recomputeFromLedger(company, item, warehouse)` repair
      path gated by `INV_MANAGE`.
- [x] 1.8 Implement `stock-ledger.service.ts`: the single writer for `stock_txn`. Expose
      insert-only helpers per `txn_type`; there is no update or delete method. Every helper takes
      an `EntityManager` so callers own the transaction boundary.
- [x] 1.9 Add `warehouse.controller.ts` and `inventory.controller.ts` (on-hand read, movement
      history with running balance, recompute) with a permission-code guard and company scope on
      every route, and `ParseUUIDPipe` on UUID params. No route creates a `stock_txn` directly.
- [x] 1.10 DTOs in `dto/` with class-validator; decimal fields validated as decimal strings.
- [x] 1.11 Register `InventoryModule` in the app module.
- [x] 1.12 Unit tests: warehouse company scoping and per-company code uniqueness; balance derived
      from a ledger fixture; `qty_available = qty_on_hand − qty_reserved`; permission-code refusal
      on every endpoint.

## 2. Issue and release — reserve, issue, release with weighted-average consumption

- [x] 2.1 Add `costing.strategy.ts` with a `WeightedAverageCosting` implementation: `applyInbound`
      (re-average, or **set** when `qty_on_hand` is zero) and `consume` (return current
      `avg_cost`, leave it unchanged). Keep it a single seam so FIFO can replace it later.
- [x] 2.2 Implement `stock-reservation.service.ts`: `reserve(em, doc)` aggregates lines by
      `(item_id, warehouse_id)` **before** locking, takes `LockMode.PESSIMISTIC_WRITE` on each
      `stock_balance` row in fixed `(item_id, warehouse_id)` order, checks availability for every
      pair, and rejects the whole submit on any shortfall without writing a partial reservation.
- [x] 2.3 Implement `issue(em, doc)`: lock the same rows in the same order, insert `ISSUE` rows
      stamped with the consumed `avg_cost`, decrement `qty_on_hand` and `qty_reserved`, recompute
      `total_value`.
- [x] 2.4 Implement `release(em, doc)`: idempotent — a document holding no live reservation writes
      no `RELEASE` row.
- [x] 2.5 Add `requires_warehouse` to `document_type` (DBML, entity, migration, DTO,
      `document-type.service.ts`), defaulting to false.
- [x] 2.6 Add `document.warehouse_id` and `document.dest_warehouse_id` (DBML, entity, migration),
      validated to resolve to active warehouses of the active company.
- [x] 2.7 Wire reservation into `back/src/modules/document/document-submit.service.ts` inside the
      **existing** submit `em.transactional(...)`, branching on `post_action` and
      `requires_warehouse` from configuration — never on a hardcoded type code. Reject lines whose
      item is not `is_stock_tracked`.
- [x] 2.8 Add the `ISSUE_STOCK` case to `back/src/modules/approval/post-action.service.ts`,
      calling `issue()` within the post-action transaction.
- [x] 2.9 Wire `release()` into the reject and cancel paths alongside the existing budget and quota
      release, so reject/cancel always releases stock.
- [x] 2.10 Unit tests: reserve does not move `qty_on_hand`; shortfall blocks submit with no rows
      written; two lines of the same item are checked against their combined quantity; issue
      discharges the reservation instead of double-counting; reject releases; double release is a
      no-op; issuing leaves `avg_cost` unchanged.
- [x] 2.11 **Concurrency test**: two concurrent submits for 6 each against available 10 — exactly
      one reserves, the other is rejected, and available never goes negative.

## 3. Receipt hook — purchases land in a warehouse

- [x] 3.1 Add `warehouse_id` to the receipt DTO and route in
      `back/src/modules/document/receiving.service.ts`, validated to an active warehouse of the
      active company.
- [x] 3.2 Inside the **existing** receipt transaction, after `received_qty` and `line_status`
      advance, write `RECEIVE` rows for lines whose item is `is_stock_tracked`, at unit cost
      `budget_base_line_amount / qty` — never recomputing an FX rate — and apply
      `applyInbound` to re-average. Lock `document_line` first, then `stock_balance` rows in fixed
      order.
- [x] 3.3 Assert in code and test that the receipt path writes no `budget_txn` row.
- [x] 3.4 Regression tests over `receiving.spec.ts`: partial→full status transitions, over-receipt
      rejection, and 3-way matching results are all unchanged for tracked and untracked items.
- [x] 3.5 Tests: receiving a tracked item creates stock at the expected cost; an untracked or
      item-less line writes no `stock_txn`; a failed stock write rolls back `received_qty` too; a
      warehouse of another company is rejected.
- [x] 3.6 **Concurrency test**: two concurrent receipts re-average to the same `avg_cost` as the
      serial result.

## 4. Adjust and transfer

- [x] 4.1 Add per-line direction and a document-level reason for `ADJUST_STOCK`; write
      `ADJUST_INCREASE` / `ADJUST_DECREASE` accordingly, applying `applyInbound` on increase and
      `consume` on decrease.
- [x] 4.2 Implement `TRANSFER_STOCK`: insert the paired `TRANSFER_OUT` and `TRANSFER_IN` in one
      `em.transactional(...)` so neither can exist without the other, carrying the source's
      `avg_cost` as the destination's inbound unit cost and re-averaging the destination.
- [x] 4.3 Reject a transfer whose source or destination warehouse belongs to another company.
- [x] 4.4 Add the `ADJUST_STOCK` and `TRANSFER_STOCK` cases to `post-action.service.ts`.
- [x] 4.5 Tests: adjustment in both directions; transfer moves quantity and cost between
      warehouses (source 110 into a destination holding 10 at 100 gives 105); cross-company
      transfer rejected; a transfer never commits one leg alone.
- [x] 4.6 **Concurrency test**: opposing transfers between the same two warehouses commit without
      deadlock, proving the fixed lock order.

## 5. Perpetual GL posting

- [x] 5.1 Extend `account_role_type` with `INVENTORY`, `INVENTORY_ADJUSTMENT`,
      `INVENTORY_IN_TRANSIT` (DBML, enum, migration) and expose them in
      `back/src/modules/gl/account-role.service.ts`.
- [x] 5.2 Add stock posting to `back/src/modules/gl/gl-posting.service.ts` with
      `source_type = 'STOCK_TXN'`, reusing the existing idempotency on
      `(company_id, source_type, source_id)`.
- [x] 5.3 Implement the entry shapes: receipt debits `INVENTORY`; issue debits the item's
      `item_company.default_gl_account` and credits `INVENTORY`; adjustment increase/decrease
      against `INVENTORY_ADJUSTMENT`; transfer between the two warehouses' inventory accounts.
      `RESERVE` and `RELEASE` post nothing.
- [x] 5.4 Round every amount to the currency's `decimal_places` and absorb the rounding residual
      into the inventory line so debits equal credits exactly.
- [x] 5.5 Make a missing, inactive, or foreign-company role mapping a logged posting failure that
      does not roll back or crash the stock movement, matching the payment-posting contract.
- [x] 5.6 Tests: balanced entry per movement type; idempotent re-post; unmapped role commits the
      movement and skips the posting; reservations post nothing; rounding residual still balances.

## 6. Web — `web-inventory`

- [x] 6.1 Add Zod schemas for the warehouse form and the three stock document forms in `shared/`,
      mirroring the backend DTOs, and a typed API client for the inventory endpoints.
- [x] 6.2 Build the on-hand view under `front-end/src/views/inventory/`: paged, filterable by
      warehouse and by item text, showing on-hand / reserved / available distinctly, with costs
      formatted to the currency's `decimal_places` and quantities to 4 places — all read as
      decimal strings, never parsed to a JS number.
- [x] 6.3 Build the per-item movement history: paged, filterable by warehouse and date range, with
      a running balance, a link from each row to its source document, and `RESERVE`/`RELEASE` rows
      visually marked as not having changed on-hand quantity.
- [x] 6.4 Build warehouse administration with `@primevue/forms` + `zodResolver`, surfacing a
      duplicate code as a field error on `code`, and deactivation behind a confirmation.
- [x] 6.5 Extend the document form renderer with a warehouse selector when `requires_warehouse` is
      true and a destination warehouse for `TRANSFER_STOCK`; offer only `is_stock_tracked` items
      enabled for the active company; show each line's available quantity beside the quantity
      input; warn on over-request but still submit and report the server's decision.
- [x] 6.6 Gate navigation and controls on `INV_VIEW` / `INV_MANAGE` from the active-company Pinia
      context as a UX-only guard.
- [x] 6.7 Add en/la i18n keys for every label, movement type, filter placeholder, empty state,
      confirmation, and validation message, and verify parity.
- [x] 6.8 Style with PrimeUI theme tokens and PrimeIcons only — no hardcoded colors — and verify
      light and dark mode.
- [x] 6.9 Component tests for the on-hand view, the history running balance, and the warehouse
      form's duplicate-code error. Import routes from `@/router/routes`, not `@/router`.

## 7. Close out

- [x] 7.1 Update the build order in `CLAUDE.md` to
      `… → document-engine → approval-workflow → inventory → notifications`.
- [x] 7.2 Seed a demo warehouse, a stock-tracked item, and the `ISSUE` / `ADJUST` / `TRANSFER`
      document types with their workflows, so the flow is exercisable end to end in the dev DB.
- [x] 7.3 Add a rebuild-from-ledger test asserting every seeded `stock_balance` reproduces exactly
      from its `stock_txn` rows.
- [x] 7.4 Run the full backend and frontend suites and confirm no pre-existing failures were added.
