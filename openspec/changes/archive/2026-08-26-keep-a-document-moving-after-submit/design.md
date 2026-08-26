## Context

Submitting a document and routing it are deliberately two acts. `DocumentSubmitService.submit()`
validates, takes the budget/quota/stock holds, stamps the FX and the base amounts, and commits;
only then does it emit `document.submitted`, and `ApprovalSubmittedListener` calls
`ApprovalRoutingService.start()` in a separate transaction. The split is on purpose — the submit
transaction holds the company-wide numbering lock, and `The Route A Document Runs Is Recorded At
Submit` forbids writing the route inside it, because every concurrent submit would queue behind it.

The seam between the two acts is where all three defects live. The e2e run
(2026-08-26, `demo_erp`) proved each of them against real HTTP traffic:

| # | Symptom | Where |
|---|---|---|
| 1 | A returned document, resubmitted, stays `SUBMITTED` forever with its budget held | `DocumentRouteService.materialise()` |
| 2 | A withdrawal accepted before the route opens is overwritten by `IN_APPROVAL` | `cancel()` vs `start()` |
| 3 | A workflow whose lowest step has an `amount_min` refuses every first submission | routability gate in `submit()` |

Defect 1 was invisible in the logs. `ApprovalSubmittedListener` special-cases the "no applicable
steps" message and logs everything else at `debug` — a level the app does not enable — so the
stranded documents produced no output at all. The error surfaced only by replaying
`POST /documents/:id/start` by hand against a second app instance with query logging on.

## Goals / Non-Goals

**Goals:**
- A resubmission routes, every time, whatever the document did on its previous attempt.
- A withdrawal the server accepted is the document's final state; nothing written afterwards
  contradicts it.
- The submit-time routability gate and the router reach the same verdict on the same document,
  which is what `Auto-Start Routing on Submit` already says they must.
- A failure to open a route is reported loudly enough that a stranded document is noticed the day
  it happens.
- The four endings of every configured document type are exercised by an automated suite against a
  live API and a real database.

**Non-Goals:**
- Moving route-writing into the submit transaction. That is forbidden by the recorded-route
  requirement and would serialise every submit behind the numbering lock.
- Making the submit → route handoff synchronous. The event decoupling is what keeps
  `document-engine` from depending on `approval-workflow` at build time; the fixes below make the
  handoff correct without collapsing it.
- Retrying a failed auto-start automatically. A stranded document is reported, and resubmitting it
  is the operator's act; a retry loop over a path that fails deterministically would only hide it
  again.
- SLA escalation, quota-controlled types, and the stock/journal/HR post-actions — this company
  configures none of them, so the run could not reach them and this change does not touch them.

## Decisions

### 1. Flush the supersede before writing the replacement route

`materialise()` sets `supersededAt` on the previous rows and creates the new ones in one unit of
work. MikroORM's `UnitOfWork.persistToDatabase()` runs `commitCreateChangeSets()` before
`commitUpdateChangeSets()`, so the INSERT reaches Postgres while the old rows still have
`superseded_at IS NULL`, and `document_approval_step_live_uniq` refuses it:

```
duplicate key value violates unique constraint "document_approval_step_live_uniq"
detail: Key (document_id, step_no)=(5ff805d4-…, 1) already exists.
```

The supersede is flushed first, in the same transaction:

```
supersede previous rows → flush → create new rows → open step 1 → flush → commit
```

**Alternative considered — `em.nativeUpdate()` for the supersede.** It bypasses the unit of work
and would work, but it also bypasses the identity map, so entities the same EM already holds would
carry a stale `supersededAt`. An explicit flush keeps one source of truth for the row state.

**Alternative considered — dropping the partial unique index.** Rejected: the index is the reason
a document can never have two live routes, and it is what caught this. Weakening a constraint to
make a write order work is how the invariant would be lost quietly later.

The atomicity the requirement demands is unaffected — both flushes are inside the same
`inTransaction`, so a reader still never sees a half-written route.

### 2. Lock the document row wherever its status is decided

`act()` already re-reads the document under `LockMode.PESSIMISTIC_WRITE` before deciding anything.
`cancel()` and `start()` do not, so their read-check-write sequences interleave: both read
`SUBMITTED`, `cancel()` commits `CANCELLED`, `start()` then commits `IN_APPROVAL` over it. Postgres
serialises the two UPDATEs, but neither statement carries a version predicate, so the second simply
wins.

Both take the same lock as `act()`. The status check then happens on a row nobody else can be
writing, and `start()`'s existing `if (document.status !== SUBMITTED) throw` becomes the guard it
was always written to be — the router refuses a cancelled document instead of resurrecting it.

**Alternative considered — an optimistic `@Version` column on `document`.** It would need a
migration on the busiest table in the schema and would turn the race into a retry loop at every
call site. The pessimistic lock matches what the concurrency rules already prescribe for a
document's transitions and what `act()` already does.

**Ordering note.** `cancel()` releases holds *after* its transaction commits
(`releaseDocumentHolds`), which is unchanged: the release is idempotent, and taking the document
lock does not extend into the ledger transaction. The lock ordering stays document row → control
points, the same order `act()` uses, so no new deadlock edge is introduced.

### 3. Give the routability gate the amount this submission computed

`WorkflowStepResolver.applicableSteps()` reads the band basis off the entity:

```ts
const base = document.budgetBaseTotalAmount ?? document.baseTotalAmount ?? '0';
```

On the submit path that column is written *later in the same method*, inside the write transaction.
The gate therefore asks "which steps apply to a document worth 0?" — and a workflow whose lowest
step starts above zero answers "none", which is why a 20,000,000 document was refused against a
10,000,000 band. On a second submission the column holds the *previous* attempt's figure, so the
gate can judge a document on an amount it no longer carries.

`applicableSteps()` gains an optional base-amount argument; the submit path passes the
`budgetToBase(total)` it has already computed, and routing (which runs after the stamp) keeps
passing nothing and reading the column. One resolver, one rule, two callers that now agree — which
is what the requirement asks for and what the current code only appears to do.

**Alternative considered — moving the gate below the stamp.** The stamp happens inside the write
transaction, after the holds are taken. Moving the gate there would mean a document with nowhere to
route reserves budget and then rolls back, which the requirement explicitly forbids ("before any
budget, stock or quota hold is taken").

**Alternative considered — stamping the amounts in a pre-pass.** A second write of the same columns
before the transaction that writes them for real; two places would then decide the same figure.

### 4. A route that fails to open is an error, not a debug line

`ApprovalSubmittedListener` keeps its special case for "no applicable steps" (unreachable once
decision 3 lands, but harmless) and raises everything else from `debug` to `error`, naming the
document and saying what it is holding. The submit has already committed by then; the listener
cannot undo it, and the only useful thing it can do is say so.

### 5. The e2e suite builds its own sandbox through the public API

The suite must not assume any particular company's configuration, and it must not write to one. It
provisions, idempotently and entirely over HTTP:

- a department (`E2E-SBX`) of its own, so no real department's mappings change;
- three accounts — a requester and two approvers — created through `employees` + `onboard`, because
  the self-approval rule needs an author who is not an approver;
- a two-step workflow targeting those approvers, because the real workflow's approvers are real
  people whose passwords the suite does not have;
- a `dept_doc_type` mapping for every active type, since the copied database maps only
  `BUDGET_PLAN` and `SPEND_HIST` and the eleven `REC*` types can otherwise not be raised at all;
- one budget per type on a node of its own, **put in force by drafting it, raising a real
  `BUDGET_PLAN` and approving it** — the only route by which a budget becomes `ACTIVE`, and the one
  that mints the control point that polices it. A fixture that reached `ACTIVE` by writing the
  column would be testing a state the product cannot produce.

**Sequence note — the ledger writes this suite causes.** Nothing in the fixture writes `budget_txn`
or `quota_usage` directly. Every row it produces comes from the product's own paths:

```
submit    → RESERVE  (one per budget, summed across the document's lines)
approve×n → ACTUAL   (+ RELEASE of the unused difference, omitted when it is zero)
reject    → RELEASE  (the whole outstanding hold)
cancel    → RELEASE  (the whole outstanding hold)
return    → RELEASE  (the whole outstanding hold)
```

The assertions read `GET /budgets/:id/breakdown` before and after each act and compare with decimal
string arithmetic (`M.add`/`M.sub`/`M.eq`), never `Number` — the base currency here is LAK, whose
`decimal_places` is 0 while the column is `numeric(15,2)`, so `100000000` and `100000000.00` are the
same money and only a decimal comparison says so.

**Transaction boundary and locking, asserted rather than assumed.** Two of the checks race real
concurrent HTTP requests, because a lock that is not taken looks exactly like one that is until two
callers arrive together:

- eight concurrent `POST /documents` must yield eight distinct `doc_no` values — the numbering lock;
- two drafts of 600,000 against a budget of 1,000,000, submitted simultaneously, must produce
  exactly one `RESERVE` and one `BUDGET_EXCEEDED` — the control-point lock in
  `BudgetLedgerService.reserveIn()`, which sorts and locks every governing control point before
  reading a balance.

Both passed on the run this change is written from, which is why neither lock is being changed.

**Serial execution.** `workers: 1`, `fullyParallel: false`. Every budget assertion is a
before/after comparison on a shared ledger; a second worker moving the same budget would make a
correct implementation look wrong.

### 6. The suite names the types it covers

Test names come from a written list (`support/expected-types.ts`), not from whatever the API
happens to return, so the report shows one line per document type and a type that disappears fails
a name rather than silently reducing the count. A guard check asserts that list still equals the
company's active types, so a type added to the company fails *there* — with a diff — instead of
going untested.

## Risks / Trade-offs

**A pessimistic lock in `cancel()` and `start()` adds contention on the document row.** → It is one
row, held for the length of a status transition, and `act()` already holds it for the same reason on
a path that runs far more often. No cross-row lock ordering changes: document row first, control
points second, exactly as today.

**Passing an explicit base amount to `applicableSteps()` gives it two modes.** → The argument is
optional and the fallback is unchanged, so routing's call site is untouched. The alternative — two
resolvers — is the thing the requirement forbids.

**The fix to `materialise()` depends on MikroORM's flush ordering, which is not part of its public
contract.** → The fix does not rely on the ordering; it removes the reliance. An explicit flush
states the dependency the code always had, and the partial unique index remains as the check that
would fail loudly if it were ever removed again.

**The e2e suite writes to whatever database it points at.** → It only ever creates: a sandbox
department, three accounts, one workflow, mappings, budget nodes and budgets, plus the documents it
raises. It updates nothing outside its own sandbox, and the one place it borrows a real object —
temporarily repointing the sandbox's own `RECWH` mapping at a purpose-built workflow to test amount
bands and parallel modes — restores it in a `finally`. It is not safe to run against production, and
`playwright.config.ts` points at `E2E_BASE_URL` with no default beyond localhost.

**The suite leaves data behind on purpose.** → Every run adds documents and ledger rows to its
sandbox. That is what makes the failures inspectable afterwards, and the sandbox department keeps
them away from anything real. A run that needs a clean slate uses a fresh database, not a cleanup
step that would destroy the evidence.

**Thirty-seven documents in the sandbox are already stranded in `SUBMITTED` holding 51,000,000 LAK,
and four carry a `CANCEL` row while sitting in `IN_APPROVAL`.** → Kept deliberately as the evidence
for defects 1 and 2 (`docs/e2e-run-2026-08-26.md`). Once the fixes land, the stranded ones route on
their next submit; the contradictory four are withdrawn again.

## Migration Plan

No migration. No schema change, no backfill, no data repair. The four code fixes are independent of
each other and can land in any order; each is covered by a check that fails today and passes
afterwards:

1. `materialise()` flush ordering → the eleven `REC*` and one `SPEND_HIST` "returned, then
   resubmitted" checks.
2. Document row lock in `cancel()` and `start()` → "withdrawing between submit and routing must not
   be undone by the router".
3. Base amount into the routability gate → "a document that engages no step at all is refused at
   submit, holding nothing".
4. Error-level logging on a failed auto-start → no automated check; verified by reading the log
   after forcing a route failure.

Rollback is reverting the commit. Nothing persisted by the new behaviour needs undoing.

## Open Questions

- **Should a stranded `SUBMITTED` document be visible in the product, not only in the log?** A
  document holding budget in nobody's queue is invisible to everyone except whoever reads the
  server log. A report or an admin list would surface it, but that is a new surface and belongs in
  its own proposal.
- **Should the routability gate run again at resubmission time against the new lines?** With
  decision 3 it does, because the base amount is recomputed each submit. Worth confirming against
  the requirement's intent when the specs are reviewed.
