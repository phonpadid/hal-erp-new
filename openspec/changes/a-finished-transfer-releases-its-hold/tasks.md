## 1. Make a transfer discharge its hold

- [x] 1.1 In `back/src/modules/inventory/stock-ledger.service.ts`, add `TRANSFER_OUT` to the
      discharging branch of `reservedDelta` alongside `RELEASE` and `ISSUE`, and update its doc
      comment to name all three. Note in the comment that `StockMovementService.release` sums the
      same set per document and must change with it.
- [x] 1.2 In `back/src/modules/inventory/stock-movement.service.ts`, add `TRANSFER_OUT` to the
      outstanding-hold loop in `release` so a document whose transfer already consumed its
      reservation computes zero outstanding. Update the method doc comment, which currently states
      the sum as `Σ RESERVE − Σ RELEASE − Σ ISSUE`, and point it at `reservedDelta`.
- [x] 1.3 Correct the comment on the `TRANSFER_STOCK` branch of
      `back/src/modules/approval/post-action.service.ts` if it now overstates or understates what
      happens — it already claims the `TRANSFER_OUT` discharges the hold, which becomes true here.

## 2. Pin it with tests

- [x] 2.1 In `back/src/modules/inventory/stock-adjust-transfer.spec.ts`, add a test that goes
      through `reserve` and then `transfer` (not `transfer` alone) and asserts the source's
      `qty_reserved` returns to 0, `qty_on_hand` falls by the transferred quantity, and available
      equals `qty_on_hand`. This is the case no existing test reaches.
- [x] 2.2 Add a test that a second transfer of the same item out of the same warehouse succeeds up
      to the full remaining on-hand — the accumulating-understatement symptom, which a single
      transfer does not expose.
- [x] 2.3 Add a test that `recompute` on a pair whose ledger holds `RESERVE` + `TRANSFER_OUT`
      reproduces `qty_reserved` 0, so the projection and the repair path agree (invariant 3).
- [x] 2.4 Add a test that `release` on a document whose transfer has completed writes no `RELEASE`
      row and leaves `qty_reserved` at 0 rather than negative.

## 3. Verify on the local database

- [x] 3.1 Run the inventory suites green: `DB_PORT=5433 DB_NAME=erp_test npx vitest run
      src/modules/inventory src/modules/gl/stock-posting.spec.ts
      src/modules/document/receiving-stock.spec.ts`.
- [x] 3.2 Run `back/scripts/verify-inventory-dev.ts` against the prod-copy database and confirm the
      source warehouse ends with `qty_reserved` 0 after the transfer document completes.
- [x] 3.3 Repair the one pair that drifted before the fix by running the `INV_MANAGE` recompute for
      it, and confirm `qty_reserved` goes from 20 to 0 — the same recompute an affected environment
      would use, exercised rather than assumed.
- [x] 3.4 Run the full backend suite and the frontend suite, and build `shared`, `back` and
      `front-end`, before anything is pushed.
