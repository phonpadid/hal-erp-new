## Context

A reference chain (`PR → PO → DISB`, `ADVANCE → CLEAR_ADVANCE`) is a line of `document` rows
linked by `ref_document_id`, permitted per company by `document_type_ref`. Budget is held once, by
the reserving ancestor (`PR`/`PROC`): `budgetsHeldByAncestors` stops a successor from reserving
again, and `PostActionService.cutBudget` walks back to that ancestor and calls
`BudgetLedgerService.settle`, which writes ACTUAL for the invoiced amount and RELEASE for the
**entire** remainder in one go. The ledger therefore honours exactly one settlement per
reservation.

`assertPredecessor` (`document.service.ts`) permits any number of successors of the same type from
one predecessor. Both entry points — manual create-from (`POST /documents/from/:refId`) and the
`CREATE_SUCCESSOR` outbox sweeper — go through `createDraft` → `assertPredecessor`. The web
detail does not know a document's successors, so the "Create successor" button is always offered
on an approved predecessor.

## Goals / Non-Goals

**Goals:**
- Refuse a second live successor per (predecessor, successor type) at creation time, with a
  message naming the one that exists.
- Make the refusal race-proof at the database.
- Let a rejected or cancelled successor be replaced.
- Keep the outbox sane when a human beat the sweep to it.
- Tell the web app which pairings are already taken.

**Non-Goals:**
- Partial `PO`s / partial invoicing (remaining-quantity tracking, settlement that releases only when
  the chain closes). Separate change.
- A per-pairing switch to allow 1:N. See Decisions.
- Changing 3-way matching or `settle()`.

## Decisions

### 1. Hard rule, not a `document_type_ref` flag

Alternative considered: `document_type_ref.single_successor boolean` (config over code,
invariant 7). Rejected for now: the ledger cannot honour 1:N — the second `DISB` fails at
`settle()` — so a flag set to "allow many" would advertise a mode that breaks at the last approval.
A flag belongs with the partial-invoicing change that makes 1:N actually work. The rule is stated
on the chain as a whole, which is still configuration-neutral: it never branches on a type code.

### 2. "Live" = `status NOT IN ('REJECTED', 'CANCELLED')`

A `DRAFT` counts. Two people opening a create-from at once should not each get a draft `PO`; and an
auto-created `DRAFT` is exactly the successor that the reservation is waiting on. `REJECTED` and
`CANCELLED` are the two terminal states that release holds (invariant 4) and end the successor's
claim on the chain, so they free the slot. `COMPLETED` counts: a completed `DISB` already settled the
reserve, and a second one has nothing left to settle.

### 3. Enforcement in two layers

- **Service** (`assertPredecessor`): after the pairing check, query
  `document WHERE ref_document_id = :refId AND document_type_id = :successorTypeId AND status NOT IN
  (REJECTED, CANCELLED)` with the company filter (the predecessor is already resolved in the active
  company, so any successor row it has is that company's). Found → `BadRequestException`
  `"<PRED_DOCNO> already has <TYPE_CODE> <SUCC_DOCNO> (<status>)"`. This is the readable, expected
  path.
- **Database**: partial unique index
  ```sql
  CREATE UNIQUE INDEX document_live_successor_uq
    ON document (ref_document_id, document_type_id)
    WHERE ref_document_id IS NOT NULL AND status NOT IN ('REJECTED', 'CANCELLED');
  ```
  Two concurrent create-froms both pass the service check; the second `INSERT` violates the index.
  `createDraft` catches `UniqueConstraintViolationException` on flush **for this index name** and
  rethrows `ConflictException` with the same message shape (re-read the winner to name it). Other
  unique violations (`doc_no`, `source_id`) keep their current behaviour. Pattern: same as
  `RefChainService.create`.

Why not `SELECT … FOR UPDATE` on the predecessor instead of an index? It would serialize the two
inserts, but `createDraft` also takes the numbering lock; adding a second row lock in a different
order across two code paths (manual + sweeper, which locks `pending_successor` first) invites a
deadlock. The index needs no lock ordering and holds even for writes that bypass the service.

**Budget/quota writes**: none. `createFrom` writes no `budget_txn`/`quota_usage` (existing rule),
and this change adds no ledger row. No new transaction boundary; the index check happens in
`createDraft`'s existing flush.

### 4. Outbox: an existing live successor fulfils the obligation

In `SuccessorSweeperService.fulfil`, before calling `createFrom`, look for a live successor of
`row.successorType` on `row.sourceDocument`. Found → mark the row `DONE`, log
`"CREATE_SUCCESSOR: <SUCC_DOCNO> already exists for <SRC_DOCNO>, obligation met"`, return `true`.
The obligation is "the source has its successor", not "the sweeper inserted it". Without this, a
`PO` raised by hand before the sweep would push the row through five failed attempts to `FAILED`
— a reportable "undelivered successor" that was in fact delivered.

Race between sweeper and a human create-from at the same instant: both pass their checks, one
insert wins the index, the loser is the sweeper → `recordFailure` → next sweep finds the live
successor → `DONE`. Or the loser is the human → 409. Either way exactly one `PO`.

### 5. Detail exposes `successors[]`

`DocumentService.detail` adds `successors: { id, docNo, typeCode, status }[]` — every document
whose `ref_document_id` is this one and whose status is live, scoped to the active company. One
extra query, populated `documentType`. Rejected/cancelled successors are omitted: the client only
needs to know which pairings are taken. Web: `DocumentDetailView` filters the successor-type picker
to pairings not present in `successors`; when every pairing is taken the action is hidden and the
existing successor(s) are shown as links. Server error (400/409) still surfaced via the existing
create-from error path.

## Risks / Trade-offs

- [Existing production rows already violate the index → migration fails] → the migration runs a
  pre-check `SELECT ref_document_id, document_type_id, count(*) … HAVING count(*) > 1` and aborts
  with the offending doc numbers in the error; the operator cancels the duplicates (which also
  releases their holds) and re-runs. Never silently skip the index.
- [`ADVANCE → CLEAR_ADVANCE` may legitimately want several clearings] → today it has the same 1:1
  settlement shape; when partial clearing is built, the 1:N flag (Decision 1) comes with it.
- [Index is on `document`, a hot table] → partial index over rows with `ref_document_id` only
  (a minority), two uuid columns; negligible write cost.
- [Cancelling a `DISB` to replace it after the `PO` was already fully received] → unchanged
  behaviour; the receipt stays on the `PO`, the new `DISB` matches against it.

## Migration Plan

1. Deploy migration `Migration20260917000000`: pre-check, then create the partial index.
   `down()` drops the index.
2. Deploy backend + frontend together (the frontend tolerates a missing `successors[]` by treating
   it as empty, so backend-first is also safe).
3. Rollback: `down()` drops the index; the service check keeps the rule minus race-safety.

## Open Questions

- None blocking. Whether the `DocumentDetailView` should also show rejected/cancelled successors as
  history is a UX nicety left out on purpose.
