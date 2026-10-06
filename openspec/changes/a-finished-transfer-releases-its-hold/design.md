## Context

`qty_reserved` has one definition in code: `reservedDelta(txnType, qty)` in
`stock-ledger.service.ts`. It returns `+qty` for `RESERVE`, `−qty` for `RELEASE` and `ISSUE`, and
zero for everything else. Two callers use it and must agree, which is why it is a free function
rather than a method: `StockBalanceService.applyMovement` applies it to a locked balance on the
write path, and the `INV_MANAGE` recompute folds it over a pair's whole ledger on the repair path.
Because both read the same helper, the recompute reproduces whatever the write path produced —
including a wrong number. That is what invariant 3 buys: the projection can be rebuilt, so a formula
fix repairs history without a migration.

A third place sums the same three types independently: `StockMovementService.release` derives a
document's outstanding hold from that document's own rows so the auto-release on reject/cancel is
idempotent. It is a separate loop over `stock_txn` filtered by `document_id`, not a call to
`reservedDelta`, because it needs the total per `(item, warehouse)` pair for one document rather
than a signed delta for one row.

The transfer path writes `RESERVE` at submit (`StockMovementService.reserve`, via the submit
service) and `TRANSFER_OUT` + `TRANSFER_IN` at full approval (`StockMovementService.transfer`, via
`PostActionService`). `TRANSFER_OUT` is in the `OUTBOUND` set that `onHandDelta` reads, so on-hand
falls correctly. It is in neither branch of `reservedDelta`, so the hold stays. The
`post-action.service.ts` comment on the transfer branch already asserts the opposite ("The
reservation taken at submit is discharged by the TRANSFER_OUT, exactly as an issue discharges its
own"), and the inventory spec's lifecycle requirement already says a `TRANSFER_STOCK` document
converts its reservation to "the paired transfer rows". Both describe the intended behaviour; only
the formula was never extended.

The existing transfer tests call `StockMovementService.transfer` directly with no prior
reservation, so there is no hold for them to observe. The defect is only reachable through the full
submit → approve path.

## Goals / Non-Goals

**Goals:**

- A fully approved `TRANSFER_STOCK` document leaves no reservation on its source warehouse.
- The write path and the recompute keep producing identical numbers, so an already-drifted
  `stock_balance` is repaired by the recompute that already exists.
- `release` and the balance agree on what a document still holds, so neither can push
  `qty_reserved` negative.
- A regression test that exercises reserve → transfer, not `transfer` in isolation.

**Non-Goals:**

- No migration, no backfill script, no data repair SQL. `stock_txn` stays untouched (invariant 2);
  the rows written were the correct rows.
- No change to `onHandDelta`, to costing, to the GL posting of a transfer (it still nets to zero
  across one company `INVENTORY` account), or to any DTO, endpoint or screen.
- Not introducing `INVENTORY_IN_TRANSIT` or multi-step transfers. A transfer remains one atomic
  movement between two warehouses of one company.

## Decisions

**Discharge in `reservedDelta`, not by writing a `RELEASE` row.**
Two shapes would fix the balance. A `RELEASE` row alongside the `TRANSFER_OUT` keeps the ledger
literally self-describing, but it makes the transfer write three rows where two express the whole
movement, and it leaves every balance already drifted unrepairable — a recompute would reproduce the
drift, because the missing `RELEASE` is missing from history. Treating `TRANSFER_OUT` as a discharge
instead mirrors `ISSUE`, which also consumes its reservation without a `RELEASE` row, matches the
sentence the spec already contains, and means the recompute fixes the past for free. The ledger
stays two rows per transferred pair and keeps saying what physically happened.

**Change `release`'s derivation in the same commit.**
Fixing only the balance creates a sharper bug than the one being fixed: a document whose
`TRANSFER_OUT` has discharged its hold would still compute 20 outstanding in `release`, and any path
that releases it would write a spurious `RELEASE` and take `qty_reserved` to −20. That path is not
reachable in today's flow — reject, return and cancel all run before approval, and an approved
document is `COMPLETED` — but the two readings of "what does this document hold" must not be allowed
to differ, since the only thing keeping them consistent today is that both are wrong in the same
direction. The `release` loop gains `TRANSFER_OUT` next to `ISSUE`.

**Leave the duplication between `release` and `reservedDelta` in place.**
Collapsing the per-document sum into the per-row helper is tempting and wrong: `release` needs a
per-pair total for one document with the pair identity carried along, and bending `reservedDelta`
into that shape would make the hot write path allocate. The two stay separate with a comment on each
naming the other, and the new scenarios pin them together behaviourally.

## Risks / Trade-offs

- **An already-drifted `stock_balance` is not repaired until someone runs the recompute.** → The
  recompute is already an `INV_MANAGE` endpoint and is the documented repair path. Production has no
  `stock_txn` rows at all, so there is nothing to repair there; the local prod-copy has exactly one
  drifted pair, which is what verifies the repair works.
- **Two definitions of the same sum can drift again.** → Mitigated by the new spec sentence
  requiring one shared set of discharging types, by a cross-referencing comment at each site, and by
  the "finished transfer has nothing left to release" scenario, which fails if only one is changed.
- **Transfers could be relied on elsewhere to hold stock after approval.** → Searched: nothing reads
  `qty_reserved` except `StockBalanceService.available`, the on-hand read surface, and `release`. A
  completed transfer holding stock has no consumer that wants it.
- **A partially-released document plus a transfer in the same document.** → A `TRANSFER_STOCK`
  document reserves and transfers the same aggregated pairs, so the sum is symmetric; a document
  that somehow transferred less than it reserved releases the remainder, which is the behaviour
  `release` already has for a partially issued document.

## Migration Plan

No schema change and no deploy ordering constraint: the change is two pure functions. Rollback is
reverting the commit; a balance written under the corrected formula is reproduced by the old formula
as the old (wrong) number, so a revert is as recoverable as the fix.

For an environment that already has drifted balances, the post-deploy step is the existing
`INV_MANAGE` recompute on the affected `(item, warehouse)` pairs — not a script.

## Open Questions

None. The spec and the code comment already agreed on the intended behaviour; this makes the formula
match them.
