## Context

The documents list (`MyDocumentsView.vue`, backed by `DocumentService.list()`) is the screen
finance works from. Three things are wrong or missing there, and they share a single question:
*what is this document's relationship to the person looking at it?*

What the live data says, and what the design has to fit:

- Every workflow in this company routes to a step whose `approver_role` is the `FINANCE` role
  (ພະແນກການເງີນ) — step 4 in most, step 3 in one, and one workflow has both 4 and 5. The design
  must produce that behaviour **without naming that role** (invariant 5), so a company that routes
  its paper elsewhere gets the right answer from configuration alone (invariant 7).
- `document_approval_step_actor` already records, per step, the principals the step waits for —
  and `DocumentRouteService.openStep` writes those rows **when the step opens**, never before
  ("The principals recorded when this step opened (empty before it opens)"). The existence of an
  actor row is therefore already a durable record that the route *arrived* somewhere.
- `document.current_step_no` is **not** a reliable "how far did it get" marker on this data: 357
  COMPLETED documents sit at `current_step_no = 1` with a single recorded step naming `admin`
  (historic/imported work), while live multi-step documents sit at 1–4 mid-route.

`ApprovalInboxService.pending` already answers "which documents may this user act on", through
`ApproverResolverService.eligible`, with the self-approval exclusion applied. Nothing new needs to
decide that question — the list simply has to ask it.

## Goals / Non-Goals

**Goals:**

- Finance can see the week's arrivals, tick them, and register receipt in one action.
- A registered receipt cannot be silently registered twice, and can be reversed only by a
  separately-granted authority, leaving both acts on the record.
- The list never offers an Approve action the server would refuse — closing the invariant 8 gap in
  the UI.
- The list names who raised each document, satisfying the two committed, skipped spec files.
- No role name, department code or document status is hardcoded into any of it.

**Non-Goals:**

- Intake does **not** confer approval authority, and does not touch the approval route. Receiving
  a document neither advances nor blocks a step.
- No budget, quota, numbering or FX behaviour changes. **No `budget_txn` or `quota_usage` row is
  written anywhere in this change**, so there is no reserve/actual/release sequence to state and no
  budget row to lock.
- Not a finance workqueue or an SLA on intake. Receipt is a fact, not a task.
- No change to `pending-approvals-summary`, whose weekly read stays what it is.

## Decisions

### 1. "The document reached me" = an opened route step that records me as a principal

The receivable set for the current user is:

```
EXISTS (
  SELECT 1
  FROM document_approval_step_actor a
  JOIN document_approval_step s ON s.id = a.step_id
  WHERE s.document_id = document.id
    AND s.superseded_at IS NULL
    AND a.user_id = :currentUser
)
```

One indexed EXISTS, evaluated set-wise over the page. It reads as what it is: *the route opened a
step at my desk*.

Because a role step materialises **every holder of the role in the company** as an actor when it
opens, any finance officer can receive any document that reached the finance step — which is the
behaviour asked for, expressed without the word FINANCE appearing anywhere.

Alternatives rejected:

- **Match `role.code = 'FINANCE'` or `department.dept_code = 'FN'`.** Direct breach of invariant 5,
  and role names are per-company labels that may collide across companies.
- **`document.current_step_no >= step.step_no`.** Wrong on this data (see Context) and fragile:
  it re-derives from a counter what the actor rows already state as fact.
- **Call `ApproverResolverService.eligible()` per step per row.** It issues several queries per
  call (company day, principals, delegation window) — N+1 across a page — and it deliberately
  layers *live* delegation and escalation on top of the recorded route. That is right for deciding
  who may **sign**; it is wrong for deciding where the **paper** went. A delegate signing while an
  officer is away does not move the desk the document landed on.
- **Restrict by status (APPROVED/COMPLETED).** Explicitly rejected by the user: documents reach
  finance while still in approval, and those are precisely the ones to register. A `DRAFT` document
  is excluded automatically — it has no route, so it has no opened step.

### 2. Receipt is an append-only log; received state is derived

New table `document_intake_log`, added to `erp_approval_system.dbml`:

| column | type | note |
|---|---|---|
| `id` | uuid pk | |
| `company_id` | uuid not null | invariant 1 |
| `document_id` | uuid not null | |
| `action` | varchar not null | `RECEIVE` / `REVERSE` |
| `actor_id` | uuid not null | who pressed it |
| `acted_at` | timestamp not null | |
| `note` | varchar null | why it was reversed |

Indexes on `(document_id, acted_at)` and `(company_id, acted_at)` — the second is the weekly read.

A document is **received** when its latest row for that document is a `RECEIVE`. The state is
computed, never stored: exactly the relationship `budget_txn` has to a budget balance (invariant 3),
and the reason a reversal is a new row rather than an erasure (invariant 2).

Alternative rejected: **`received_at` / `received_by` columns on `document`.** They cannot record a
reversal without destroying the receipt that preceded it, which is the one thing a privileged undo
must not do. They would also put a derived value beside the ledger that defines it — the mistake
invariant 3 names for budgets ("never overwrite `budget.amount_total` to reflect usage").

### 3. Two permission codes, not one

- `DOC_INTAKE_RECEIVE` — register receipt. Granted to the finance role.
- `DOC_INTAKE_REVERSE` — reverse one. The privileged correction, granted separately.

`DOC_RECEIVE` is **not** reused: it already means goods receipt against a PO's lines, and a code
that means two different receipts is a code that gets granted for one and used for the other. Codes
live in the TypeScript catalog and reach the database through `permissions:sync`, which the deploy
already runs before `permissions:check` — so no migration carries them.

Holding `DOC_INTAKE_RECEIVE` is necessary but not sufficient: the document must also have reached
the holder. That is what keeps a finance officer from registering paper that never came to them.

### 4. Bulk receive reports per document, and one refusal does not lose the batch

`POST /documents/intake/receive` takes `{ documentIds: string[] }` and answers per document:
`RECEIVED`, or a refusal naming why (`ALREADY_RECEIVED`, `NOT_REACHED`, `NOT_FOUND`). Ticking
twenty rows where one was already registered by a colleague must register the other nineteen and
say which one it skipped — a whole-batch rollback would make the screen unusable exactly when two
people share the week's intake.

Each document is settled in its own `em.transactional(...)`, so one refusal cannot roll back a
sibling's row. Company scope is applied to the id list before anything is written: an id from
another company is `NOT_FOUND`, never a receipt (invariant 1).

### 5. Double receipt is prevented by locking the document row, not by a unique index

Two finance officers pressing receive on the same document at the same moment must produce one
`RECEIVE` row. Inside each document's transaction the document row is taken with
`LockMode.PESSIMISTIC_WRITE` (`SELECT FOR UPDATE`) **before** the latest intake row is read, so the
read-then-decide pair serialises — the same pattern the approve path and document numbering use.

A unique index cannot express it: the table is append-only and legitimately holds
`RECEIVE, REVERSE, RECEIVE` for one document, so uniqueness on `document_id` is simply false.

A concurrency test covers it. CLAUDE.md requires one where budget or numbering is touched; neither
is, but this is the identical read-then-decide race, and the invariant it protects ("cannot be
received twice") is the whole point of the feature.

### 6. The Approve button asks the server, once per page

New `POST /approvals/actionable` takes the page's document ids and returns the subset the caller
may act on, resolved by the **same** `ApprovalInboxService` path that `/approvals/pending` uses.
The list renders the Approve button only for ids in that subset — `v-if`, not `:disabled`.

One batch call per page, replacing the current per-row `pendingApprovers` fan-out for this purpose.

Alternatives rejected:

- **Compute `canApprove` inside `DocumentService.list()`.** It would put a second implementation of
  eligibility-and-self-approval in the document module, free to drift from the approval module's.
  Invariant 8 should have exactly one implementation.
- **Fetch `/approvals/pending` and intersect client-side.** It is paginated over a different set;
  a document on list page 3 may sit on inbox page 1, so the intersection is wrong whenever either
  list is longer than a page.
- **Keep the button disabled rather than absent.** The user asked for absent, and a disabled
  control still tells a requester the system contemplates them approving their own document.

### 7. Requester name resolved once per page, reusing the rule detail() already uses

`list()` gains `requesterName` and `requesterDepartment` per row: `employee.full_name` for the
creator's employee record **in the document's company**, falling back to `app_user.username`, with
the department from the same employee record. `pending-summary.service.ts` already resolves exactly
this — the helper moves to a shared place rather than being written a second time.

One batched query per page keyed on the page's distinct creator ids, which is what
`who-raised-it.spec.ts` pins ("resolving a page does not cost a query per row").

The skipped specs are **unskipped and satisfied**, not rewritten. They are the contract.

## Risks / Trade-offs

- **A role step materialises every holder, so every finance officer can receive every document
  that reached finance.** → This is the intent (the desk, not the person), and it is what makes a
  bulk weekly intake possible at all. Who actually pressed it is on the log row.
- **A document that reached finance and was later rejected stays receivable.** → Correct: the paper
  did arrive. Status is deliberately not consulted, and the list shows the status beside the intake
  column so the reader sees both.
- **`POST /approvals/actionable` runs the eligibility resolver for up to a page of documents.** →
  Bounded by the page size (20), and it replaces a per-row fan-out that was already running. If a
  larger page size is ever offered, this is the read to measure first.
- **Reversal is a real hole if `DOC_INTAKE_REVERSE` is granted widely.** → Separate code, off by
  default, and every reversal is a log row naming its actor. The catalog entry says what it is for.
- **Two new columns widen an already wide table on narrow screens.** → Both carry
  `data-priority="secondary"`, the mechanism the list already uses to drop columns at narrow
  widths.

## Migration Plan

1. Add `document_intake_log` to `erp_approval_system.dbml`, then generate the migration from the
   entity so the migration and the entity cannot disagree.
2. Add `DOC_INTAKE_RECEIVE` and `DOC_INTAKE_REVERSE` to the permission catalog. The deploy runs
   `permissions:sync` then `permissions:check` before restarting, so the codes exist before any
   endpoint behind them answers; until a role is granted one, those endpoints answer 403 to
   everyone, which is the safe direction.
3. Deploy. The table is empty, the columns render "not received" for every row, and nothing else
   on the screen changes behaviour except the Approve button, which becomes narrower — it can only
   ever remove an action the server was already refusing.
4. Grant `DOC_INTAKE_RECEIVE` to the finance role through the RBAC admin screen. No data
   backfill: there is no record of which documents finance received before this existed, and
   inventing one would put fictional names on an append-only log.

**Rollback**: revert the deploy. The table can be left in place — nothing reads it, and dropping a
log that recorded real acts is worse than leaving it. No other table is altered, so there is no
down-migration that can lose data.

## Open Questions

- Should a reversal require a note? The column allows one; the DTO could require it. Leaning
  optional-but-prompted, since an officer correcting their own misclick within the minute has
  nothing useful to write.
- Should the list gain a "received / not received" filter alongside the week filter? Not needed for
  the workflow as described (filter the week, read the column), so it is left out until asked for.
