## Context

`PostActionService.run` executes a document type's `post_action` inside the approval transaction,
under a 3-attempt retry, so a persistent failure propagates and rolls the terminal transition back
(`post-action.service.ts:26-31`). `CUT_BUDGET`, `TRANSFER`, `ADJUST_*`, `UPDATE_EMPLOYEE`, and
`TERMINATE_EMPLOYEE` all work this way. `CREATE_SUCCESSOR` alone returns early at `:52` and is
instead invoked after commit from `approval-routing.service.ts:284`, wrapped in a try/catch that
logs and moves on (`:107-109`).

**Why it was written that way.** `createFrom` cannot run inside the approval transaction as
things stand: it re-checks `document.status === DocStatus.COMPLETED` (`:88`), and `createFrom`'s
own `assertPredecessor` requires the predecessor to be `APPROVED` or `COMPLETED`
(`document.service.ts:188`). Inside the transaction the document has not reached `COMPLETED` yet.
The post-commit placement is a workaround for that ordering, not carelessness — and the swallow
is what keeps a config error from silently rolling back six approvers' work. Both instincts are
right; the combination is what fails the spec.

The constraint to respect: the fix must not make a bad successor configuration able to reject an
otherwise-valid approval, and must not leave the failure invisible.

## Goals / Non-Goals

**Goals:**
- Make the intent to create a successor durable, committed atomically with the approval.
- Keep successor creation itself outside the approval transaction.
- Turn a persistent failure into a queryable state instead of a log line.
- Conform to `approval-workflow`'s "never half-applied" rule, honestly rather than by redefinition.

**Non-Goals:**
- Creating the successor synchronously. Approval must not depend on it.
- A retry endpoint or an admin UI for `FAILED` rows — a follow-up, once the state exists.
- Reworking `createFrom`, `assertPredecessor`, or the `COMPLETED`-before-create ordering.
- Fixing the 3-way match tolerance or the `SEQUENTIAL`/`PARALLEL_ANY` overlap.

## Decisions

### An outbox table, not a synchronous create

On full approval, `CREATE_SUCCESSOR` inserts one `pending_successor` row per configured
auto-create pairing, inside the approval transaction. A sweep drains them afterwards.

This is what makes "never half-applied" true rather than reworded. The document and the obligation
commit together: if the transaction commits, the successor is owed and recorded; if it rolls back,
neither exists. There is no window where a `COMPLETED` document has no record that it owes a PO.
The gap the spec objects to is not "the PO does not exist yet" — it is "the PO will never exist
and nothing knows".

*Alternative rejected — move `createFrom` into the transaction (the literal reading of the spec).*
It requires unpicking the `COMPLETED`-before-create ordering, and it hands a config error veto
power over an approval: deactivate a successor type and every PROC approval starts failing at the
final step, with an error the approver cannot act on and did not cause. The spec's intent is that
approval and its consequences agree — not that a downstream document type's health gates the
approve button.

*Alternative rejected — keep best-effort, add alerting.* Cheapest, and it leaves the durability
hole: an error between commit and the create call (process restart, unhandled rejection outside
the try) loses the obligation entirely, with nothing to alert on. Alerting on a lost intent
requires the intent to have been written down. Once it is written down, the sweep is the easy part.

### The outbox is a work queue, deliberately not append-only

Rows move `PENDING → DONE` or `PENDING → FAILED`, with `attempts` and `last_error` updated in
place. Invariant 2 covers `budget_txn` and `approval_log` — ledgers, where history is the product.
This is neither; making it append-only would mean a status-projection read on every sweep to
answer "what is still owed", for no audit benefit that `approval_log` and the created document's
own `ref_document_id` do not already provide. It is a separate table for exactly this reason: a
mutable queue must not be mixed into a ledger, and a `document` column would smear queue state
across an entity that is not one.

### Bounded attempts, then a visible `FAILED`

Each sweep attempt increments `attempts`; past a bound the row becomes `FAILED` with its
`last_error` retained. Unbounded retry would hammer a permanently broken configuration forever
and hide it in the noise; `FAILED` is a queryable answer to "what did approval promise and not
deliver". A `FAILED` row is never retried automatically, so the state is stable enough to report
on and to build the follow-up retry endpoint against.

### The sweep claims rows under a pessimistic lock

*Sequence note (this flow writes neither `budget_txn` nor `quota_usage`):* the outbox insert joins
the **existing** approval transaction — it takes no new lock and must not, since that transaction
already holds `SELECT FOR UPDATE` on the document row (`approval-routing.service.ts:191-194`) and
on every budget it settled, in a sorted lock order chosen to avoid deadlock. Adding a lock there
risks that ordering; an insert does not.

The sweep runs in its own transaction per row: `SELECT ... FOR UPDATE SKIP LOCKED` on a `PENDING`
row, then `createFrom`, then mark `DONE` — so two app instances sweeping concurrently cannot both
create the same successor, and a slow row does not block the queue behind it. `SKIP LOCKED`
rather than plain `FOR UPDATE` because a blocked sweeper is worse than a deferred row.

*Not relied upon:* `createFrom` issues a document number under its own `SELECT FOR UPDATE`
(`numbering.service.ts`), which serializes numbering but would not stop two sweepers from creating
two distinct successors for one intent. The claim is what guarantees once-only; numbering only
guarantees the numbers differ.

### The successor's department is configured; its creator is the source requester

`createDraft` reads three things from `RequestContext`: `companyId`, `departmentId` — which
resolves the dept mapping and therefore pins the successor's **form template and workflow** — and
`userId`, which becomes `created_by` (`document.service.ts:86-88`, `:113-117`). A sweep has no
request to read them from, so the values must come from somewhere explicit. That forces a question
the current code answers by accident: running post-commit inside the approving user's request, the
auto-created successor today inherits the **approver's** department and the **approver's**
identity.

Both are wrong, and the second is actively harmful. `created_by` = last approver collides with
invariant 8: whoever signs the `PROC` last is silently barred from approving the `PO` it creates.
Nobody designed that; it is a side effect of where the call happened to sit.

**`created_by` = the source document's `created_by`.** The successor exists because that person
asked for it; the audit chain reads straight through, and the invariant 8 collision disappears.

**Department = `document_type_ref.successor_department_id`, falling back to the source document's
department when null.** This is the business question the inheritance rules were dodging: in real
procurement the requesting department asks and the buying department buys — a `PO` belongs to
Procurement whether IT or Finance raised the requisition. Null covers same-department chains
(`ADVANCE → CLEAR_ADVANCE`); set covers the cross-department handoff (`PROC → PO`). Per invariant
7 that is configuration on the pairing that already defines the chain, not a rule inferred from a
person.

*Alternative rejected — inherit the source document's department.* Smaller, and it looks safe
because the seed maps every type to the one `PROC` department, so nothing diverges there. In a
real multi-department deployment it breaks: `DeptDocTypeService.resolve` throws when the
(department, type) pair has no active mapping (`dept-doc-type.service.ts:159-169`), so a `PROC`
raised by IT would owe a `PO` that IT cannot create, and every obligation would land in `FAILED`.
That is this change's own bug wearing a different hat — silent non-delivery, discovered late.

*Alternative rejected — preserve today's behaviour by stamping the approver's department and user
onto the outbox row.* Zero regression risk and honest about it, but it spends two columns
enshrining an accident as a design, and keeps the invariant 8 collision forever.

*Alternative rejected — a system user as `created_by`.* There is no system principal in this
codebase, and inventing one to own procurement documents muddies "who asked for this" for no gain.

### `CREATE_SUCCESSOR` rejoins the normal post-action path

With the outbox, the action is just "insert rows" — it needs no early return at `:52`, no
`@Optional() DocumentService` in `PostActionService`, and no post-commit hook at
`approval-routing.service.ts:284`. It gains the same bounded retry every other action has, which
now covers a transient failure to *record the intent* — the one part that should indeed roll the
approval back, because an approval whose obligation was not recorded is precisely the half-applied
state.

## Risks / Trade-offs

**The successor is no longer immediate** → It appears within a sweep interval instead of on the
approval response. This is the change's real cost. Mitigate by triggering a sweep on the
`approval.outcome` (`COMPLETED`) event and treating the timer as the safety net rather than the primary path.

The blast radius is smaller than it looks. `document-engine`'s auto-create scenarios are all
phrased "**WHEN** the `CREATE_SUCCESSOR` post-action runs" (`spec.md:291-303`), not "when the
document is approved" — they stay true when the work moves to the sweep. Only one test file
touches this (`approval-workflow.service.spec.ts:585`) and it invokes
`createSuccessorIfConfigured` directly rather than approving and asserting, so it re-points at the
sweep rather than being rewritten around a delay. Nothing found asserts the successor exists on
the approve response.

**A `FAILED` row is still only as visible as someone looking** → It is queryable, which the log
line was not, but this change ships no UI and no alert. The gap narrows from "invisible" to
"unsurfaced"; closing it is the named follow-up.

**Two sweepers, one intent** → The `FOR UPDATE SKIP LOCKED` claim is the guard. Worth a
concurrency test, since a duplicate PO is a real-money error and the numbering lock will not catch
it.

**A crash between `createFrom` and marking `DONE`** → The row stays `PENDING` and the successor is
created twice on the next sweep. Mitigate by marking `DONE` in the same transaction as the create,
so the two commit together — the reason the sweep uses one transaction per row rather than
creating first and bookkeeping after.

**Rows accumulate** → `DONE` rows are never cleaned up here. Low volume (one per auto-create
pairing per approval), but unbounded; a retention pass is a follow-up.

## Migration Plan

1. Additive migration: create `pending_successor`. Nothing backfills — a `PROC` that already
   completed without its PO stays that way, and is created manually as it is today.
2. Ship the outbox write, the sweep, and the removal of the post-commit path together. Shipping
   the write alone would queue intents nothing drains; shipping the removal alone would drop them.
3. Update `erp_approval_system.dbml`.

*Rollback:* revert the code and the table is inert; any `PENDING` rows left behind are unclaimed
work, so drain the queue before rolling back or create those successors by hand. This is the one
step that is not cleanly reversible, and it is worth saying so plainly rather than discovering it
during an incident.

## Resolved Questions

- **Sweep interval: 1 minute.** The existing `approval.outcome` (`COMPLETED`) event is the normal path; the timer only
  catches a missed event, and a minute keeps that recovery invisible to a requester who is still
  looking at the document. The claim query is indexed on `(status, created_at)`, so a mostly-empty
  sweep is cheap enough to run this often.
- **Retry bound: 5 attempts, then `FAILED`.** Enough to ride out a numbering clash or a brief DB
  blip; not so many that a permanently broken configuration stays "still trying" for an hour. At a
  1-minute interval the bound is reached in ~5 minutes, which is the number that actually matters.
- **An inactive successor type produces no obligation at all.** Checked in the post-action, before
  the row is written: deactivating a type is an admin saying "stop using this", so failing to
  create it is compliance, not a fault. It stays the logged skip it is today
  (`post-action.service.ts:100-102`) and never reaches `FAILED` — which keeps `FAILED` meaning
  "the system promised something and could not deliver", the only reading that makes the state
  worth reporting on.

## Open Questions

- None blocking. The retry endpoint and the `FAILED` queue UI remain the named follow-up.
