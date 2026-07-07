## Context

The scaffold provides `budget`, `budget_txn` (append-only), `budget_movement` and the
seams: `LedgerGuardSubscriber` (already registered globally — rejects update/delete of
`budget_txn`/`approval_log`), `AppendOnlyRepository`, and `inTransaction`/`lockForUpdate`
(`em.transactional` + `LockMode.PESSIMISTIC_WRITE`). `multi-currency` is implemented but
budget-control operates purely in base currency — callers convert first. Documents and
approval don't exist yet, so budget-control delivers the **engine** other slices call.
No schema change.

`budget` is not a `CompanyScopedEntity`; it is scoped through
`fiscal_year → company` and `department → company`. `budget_txn.document_id` is NOT NULL,
so every ledger row belongs to a document (tests seed a minimal document graph).

## Goals / Non-Goals

**Goals**
- Budget CRUD (never overwrite `amount_total`) + derived-balance query.
- `reserve` / `settle` / `releaseAll` and `executeTransfer` / `executeAdjustment`,
  all writing `budget_txn` insert-only inside one transaction.
- Concurrency-safe reservation (lock budget rows `FOR UPDATE`; HARD_STOP can't overcommit).
- Transfer boundaries: reject cross-company and cross-fiscal-year; reject if source lacks
  available balance.
- Deliver services for document-engine / approval-workflow; unit + concurrency tests.

**Non-Goals**
- Document submit/line/receipt flow (document-engine) — caller passes documentId + base
  line amounts.
- Wrapping transfer/adjust as approvable documents + routing (approval-workflow); here
  execution runs on an already-approved `budget_movement`.
- Currency conversion (done upstream) and payment-time FX gain/loss posting.

## Decisions

### D1 — Balance derivation is the single source of truth (invariant 3)
`BudgetBalanceService.availableBalance(budgetId, em?)` sums `budget_txn` by `txn_type`:
`amount_total + ADJUST_INCREASE − ADJUST_DECREASE + TRANSFER_IN − TRANSFER_OUT − RESERVE
− ACTUAL + RELEASE`, all via `Money`/`Decimal` (strings, never floats). Computed with a
grouped query (`SELECT txn_type, SUM(amount) ... GROUP BY txn_type`) plus `amount_total`.
`amount_total` is never written after creation. The spec's "real available" for transfers
is interpreted as this same derived available balance (money actually free to commit).

### D2 — Reserve: lock, check policy, insert — one transaction
`reserve(documentId, lines: {budgetId, baseAmount}[], { createdBy? })`:
1. Group lines by `budgetId`, summing base amounts (one RESERVE per budget — spec: "one
   RESERVE per budget").
2. In `inTransaction(em)`: for each budget (ordered by id to avoid deadlocks)
   `lockForUpdate(Budget)`, compute `availableBalance` **inside the txn**, and:
   - HARD_STOP and `requested > available` → throw `BadRequestException` (whole submit
     rolls back — invariant: no partial reserve).
   - SOFT_WARNING and insufficient → collect a warning, proceed.
   - insert a RESERVE `budget_txn`.
3. Return `{ warnings: [{budgetId, requested, available}] }`.
The lock + in-transaction balance read is what makes two concurrent full-balance reserves
resolve to exactly one success (the second sees the first's RESERVE after the lock).

### D2a — Why locking works here
`lockForUpdate` issues `SELECT … FOR UPDATE` on the `budget` row; the second transaction
blocks until the first commits, then its `availableBalance` recomputation includes the
first RESERVE and the HARD_STOP check fails. Each reserving request gets its own
`em.fork()` transaction (request-scoped), matching how document-engine will call it.

### D3 — Outstanding reserved drives settle / auto-release (invariant 4)
`outstandingReserved(documentId, budgetId, em)` = `Σ RESERVE − Σ RELEASE − Σ ACTUAL` for
that document+budget.
- `settle(documentId, budgetId, actualAmount)`: insert ACTUAL `actualAmount`, then RELEASE
  `outstanding − actualAmount` (never negative — reject if `actualAmount > outstanding`).
- `releaseAll(documentId)`: for each budget the document reserved against, RELEASE the
  current outstanding (reject/cancel frees everything). Idempotent: outstanding 0 → no row.

### D4 — Transfer / adjustment execution (atomic, bounded)
`executeTransfer(movement)` (movement carries `document`, `fromBudget`, `toBudget`,
`amount`):
- Reject if `fromBudget` / `toBudget` resolve to different companies (via
  `department.company` / `fiscalYear.company`) — invariant 1, no inter-company transfer.
- Reject if `fromBudget.fiscalYear !== toBudget.fiscalYear` (cross-year).
- In one `inTransaction`: lock both budgets, check `availableBalance(from) >= amount`, then
  insert TRANSFER_OUT (from) + TRANSFER_IN (to). Both or neither.
`executeAdjustment(movement)`: insert a single ADJUST_INCREASE or ADJUST_DECREASE per
`movement.movementType`. These run on an already-approved movement (approval-workflow
calls them); budget-control does not itself approve.

### D5 — Append-only writes
All ledger writes are `em.create(BudgetTxn, …)` + flush — never update/delete. The global
`LedgerGuardSubscriber` enforces this (throws on scheduled update/delete); a test asserts
an attempted update throws. `BudgetTxn` repository may use `AppendOnlyRepository` for the
typed insert/read surface; enforcement does not depend on it.

### D6 — DTOs / endpoints
- `budgets`: CRUD (DTO: `fiscalYearId`, `departmentId`, `glAccount`, `budgetName?`,
  `amountTotal` as `@IsNumberString`, `controlPolicy?`); `GET /budgets/:id/balance`.
- Manual ops endpoints guarded by `BUDGET_MANAGE` for transfer/adjust **execution**
  (until approval-workflow drives them) and a balance read (`BUDGET_VIEW`). `reserve` /
  `settle` / `releaseAll` are primarily service-to-service (document-engine), exposed as
  methods; thin endpoints optional.
- `ParseUUIDPipe` on id params; amounts are strings end to end.

## Risks / Trade-offs

- **`budget_txn.document_id` NOT NULL** means even transfers/adjustments need a document
  (the movement's transfer/adjust document). Tests seed a minimal document graph; in
  production the movement always has one. Documented so it isn't mistaken for a gap.
- **Balance recomputed per check** (grouped SUM) rather than a cached column → correct by
  construction (invariant 3) and fine at this scale; a materialized cache can come later
  without changing the contract.
- **Deadlock risk** locking multiple budgets in one reserve/transfer → mitigated by always
  locking in a deterministic order (sorted by budget id).
- **Interpretation of "real available"** for transfers = derived available balance; noted
  so a future "exclude outstanding reservations" rule is an explicit change, not a silent
  one.

## Migration Plan

No DB migration. Steps: build `BudgetControlModule` (services, controllers, DTOs,
permission constants); register in `AppModule`; add unit + concurrency tests (incl. an
append-only-violation test); `pnpm build` + `pnpm test`. Rollback = revert the module.

## Open Questions

- Should `reserve` accept a fiscal-period guard (reject reserving into a CLOSED fiscal
  year via multi-company `assertOpenPeriod`)? Default: document-engine calls
  `assertOpenPeriod` at submit; budget-control stays period-agnostic. Revisit if reserve
  is ever called outside document submission.
- Should SOFT_WARNING warnings be persisted (audit) or only returned? Default: returned in
  the response; persistence can be added with notifications.
