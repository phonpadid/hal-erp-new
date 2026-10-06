## Why

An inter-warehouse transfer takes a `RESERVE` on the source warehouse at submit and never gives it
back. `reservedDelta` discharges a hold on `RELEASE` and `ISSUE` only, so once a `TRANSFER_STOCK`
document is fully approved its `TRANSFER_OUT` removes the quantity from `qty_on_hand` and leaves
`qty_reserved` exactly where it was. The source warehouse's available quantity — `qty_on_hand −
qty_reserved` — is permanently understated by every quantity ever transferred out of it, and the
understatement accumulates. Eventually a submit is refused for insufficient stock against a
warehouse whose shelves are full, with no way to clear the phantom hold: `stock_txn` is append-only,
no endpoint can write a `RELEASE`, and the `INV_MANAGE` recompute reproduces the same wrong number
because it replays the same formula.

Reserve-then-actual is invariant 4, and the inventory spec already requires a `TRANSFER_STOCK`
document to "convert that reservation to ... the paired transfer rows" on full approval. The code
comment at the transfer post-action says the reservation "is discharged by the TRANSFER_OUT, exactly
as an issue discharges its own". Neither is true today. This is the formula catching up with the
behaviour both already describe.

## What Changes

- `TRANSFER_OUT` becomes a discharge of a reservation, alongside `RELEASE` and `ISSUE`, in the one
  function that defines what a movement does to `qty_reserved`.
- The outstanding-hold derivation inside the auto-release path changes with it, so the two readings
  of "what does this document still hold" cannot disagree. Without this half, a fix to the balance
  alone would let a release run on a document that already transferred and drive `qty_reserved`
  negative.
- No migration and no backfill. `stock_balance` is a projection (invariant 3), so the existing
  `INV_MANAGE` recompute rebuilds any already-drifted row from its ledger under the corrected
  formula. The ledger itself is correct and untouched — the rows that were written were the right
  rows; only their effect on the projection was wrong.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `inventory`: the Derived Stock Balances requirement states `qty_reserved` = Σ `RESERVE` − Σ
  `RELEASE` − Σ `ISSUE`. It gains − Σ `TRANSFER_OUT`, and a scenario covering a completed transfer
  leaving no hold behind.

## Impact

- `back/src/modules/inventory/stock-ledger.service.ts` — `reservedDelta`, the single definition of a
  movement's contribution to `qty_reserved`. Read by `StockBalanceService.applyMovement` (the live
  write path) and by its recompute (the repair path), so both move together.
- `back/src/modules/inventory/stock-movement.service.ts` — `release`, whose per-document outstanding
  sum mirrors the same three types.
- No schema change, no DTO change, no endpoint change, no frontend change. `qty_reserved` is already
  on every on-hand read; its value becomes correct for transfers.
- Invariants touched: 2 (the ledger stays append-only — nothing is rewritten), 3 (the projection
  must still replay exactly from the ledger, which is what the shared helper guarantees), 4
  (reserve → actual → release, which is the invariant being restored).
- Behavioural risk is confined to transfers. An issue, an adjustment and a receipt contribute
  nothing to `qty_reserved` today and still contribute nothing.
