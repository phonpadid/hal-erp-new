## Context

A reference chain is one purchase expressed as several documents (`PROC → PO → DISB`), linked by
`ref_document_id`. `createFrom` copies the predecessor's lines — budget included — so every
budget-controlled document in the chain reserved the same money again at submit.

Settlement was already chain-aware and assumed the opposite: `PostActionService.cutBudget` walks
`ref_document_id` back to the document that actually reserved and settles *that* one
(`resolveReservingDocument`), and its own comment notes that a `CUT_BUDGET` type is "typically
`requires_budget=false`". The seeded configuration has `DISB.requires_budget = true`, so both ends
took a hold and only one was ever converted. The other stayed RESERVE forever: a COMPLETED document
is released only on reject/cancel, neither of which can still happen.

Observed live in company HAL: `PROC-HAL-2026-0001` RESERVE 50,000, `DISB-HAL-2026-0007` RESERVE
50,000 + ACTUAL 50,000 — a 50,000 purchase that cost the budget 100,000, half of it unrecoverable.

## Goals / Non-Goals

**Goals:**
- One outstanding budget hold per reference chain, whatever `requires_budget` says for each type.
- Settlement, GL posting, and the reservation all resolve the same holder, so they cannot diverge.
- Behavior of a standalone document (no `ref_document_id`) is unchanged.
- No document can be paid without its chain having cut the budget exactly once.

**Non-Goals:**
- Changing `document_type.requires_budget` configuration (invariant 7 — behavior stays
  configuration-driven; this rule is about not double-counting the same money, not about which
  types control budget).
- Schema or DBML changes. No column recording "which document holds the chain's reserve" — the
  ledger already answers that by walking `ref_document_id`.
- Partial/multiple settlements of one chain. `settle` still ACTUALs the consumed amount and
  RELEASEs the remainder, closing the hold in one step.
- Repairing rows stranded before this change (a separate, append-only correction).

## Decisions

**Prevent the second hold at submit rather than release it at settlement.**
The alternative — let both reserve, then release the ancestor's when the successor settles — keeps
the budget over-held for the whole approval window (the reason a hold exists at all is to stop that
money being spent twice), and adds a release with no matching reserve semantics. Skipping the
duplicate keeps the ledger a true record of what is held.

**"Held" means outstanding, not "has a RESERVE row".**
Outstanding is `Σ RESERVE − Σ RELEASE − Σ ACTUAL` for that document+budget (`outstandingReserved`).
An already-settled predecessor holds nothing, so its successor must take its own hold — otherwise a
document could be approved and paid with no budget cut at all, which is worse than double-counting.

**Resolve by walking `ref_document_id`, mirroring `resolveReservingDocument`.**
`budgetsHeldByAncestors(documentId, budgetIds, em)` lives in `BudgetLedgerService` next to the other
ledger semantics, walks ancestors with a `seen` set (a malformed cycle terminates), and stops early
once every candidate budget is accounted for. Same traversal, same answer, on both the reserve and
the settle side.

**GL posting follows the same chain.**
`GlPostingService.postForPayment` derives the expense side from the paid document's ACTUAL rows.
With the hold on an ancestor those rows are on the ancestor, so an unchanged posting would find
none, log "no ACTUAL budget_txn", and skip the entry — payment recorded, nothing in the GL. It now
falls back to the nearest ancestor holding ACTUAL rows. (This gap predates the change: it would
also have fired on the `requires_budget=false` path the settlement code was written for.)

### Sequence — budget_txn writes

Submit (one `em.transactional`, per invariant/concurrency rules):
1. Resolve lines → `reserveLines` (budget id + base amount at BUDGET_RATE).
2. `budgetsHeldByAncestors` locks each candidate budget `FOR UPDATE` in ascending id order — the
   same deterministic order `reserveIn` uses, so the two can never deadlock against each other —
   then reads each ancestor's outstanding reserve.
3. Reserve only the budgets no ancestor holds. The locks taken in step 2 are held to commit, so a
   concurrent settle of the ancestor cannot slip between the check and the insert; `reserveIn`
   re-locking the same rows in the same transaction is a no-op.
4. Everything else in the submit (stock, quota, status) commits or rolls back with it.

Approval (`PostActionService.cutBudget`, inside the approval transaction): unchanged — resolve the
chain's reserving document, `settle` it (ACTUAL + RELEASE of the remainder) under a budget lock.

Payment: unchanged for `budget_txn` — GL posting runs post-commit in its own transaction and writes
no `budget_txn` (invariant 6).

## Risks / Trade-offs

- **A successor invoices more than its ancestor holds (over-billing inside the 3-way-match
  tolerance) → `settle` rejects with "Actual exceeds outstanding reserved" at approval time.** The
  approver sees the block instead of the budget silently absorbing the excess; the fix is to correct
  the invoice or adjust the budget. This is the pre-existing behavior of the chain-settlement path,
  not new to the skip.
- **The chain's hold is taken at the ancestor's rate/amount, not the successor's.** Deliberate: it
  is the same money, and re-reserving at a later rate would reopen the double-count. FX movement
  between the two goes to accounting (invariant 8).
- **Two extra reads plus the budget locks at submit.** Bounded by the chain depth (2–3 in practice)
  and the locks were going to be taken by `reserve` moments later anyway.
- **A chain whose ancestor was cancelled after the successor submitted** relies on the successor
  having taken its own hold at submit (the ancestor's release makes its outstanding 0 only for
  later submits) — covered by the outstanding-based check.
