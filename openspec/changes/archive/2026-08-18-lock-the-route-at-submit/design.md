# Design

## D1. One row per step the route will run, written once

```
document_approval_step
├─ id, document_id, step_no                  the route as it stood at submit
├─ step_name, approve_mode, sla_hours        copied, not joined
├─ approver_role_id / approver_user_id       the target as configured then
├─ show_signature_on_pdf                     so an issued sheet stays the sheet
├─ status        PENDING / DONE / SKIPPED    per-step lifecycle
├─ started_at, completed_at                  per-step clock
├─ superseded_at                             set when a resubmit replaces this route
└─ source_workflow_step_id                   traceable back to the configuration used
```

`(document_id, step_no)` is not unique on its own — a returned-and-resubmitted document keeps its
first route (D7) — so the uniqueness that matters is `(document_id, step_no)` among rows where
`superseded_at is null`, expressed as a partial unique index.

No `company_id`. `approval_log` and `workflow_step` carry none either: this is a child of
`document`, every query reaches it through a document that is already company-scoped, and adding a
column that can disagree with its parent creates a way to be wrong that does not exist today.

## D2. The change is a table swap at six lookups, not a rewrite

Every reader asks the same question in the same shape today:

```ts
findOne(WorkflowStep,        { workflow: doc.workflow.id, stepNo: doc.currentStepNo })
findOne(DocumentApprovalStep,{ document: doc.id,          stepNo: doc.currentStepNo, supersededAt: null })
```

Six call sites, one shape:

| file | what it wanted the step for |
| --- | --- |
| `approval-routing.service.ts` | `act`, `canAct`, `pendingApprovers`, `start`, `stepComplete` |
| `sla.service.ts` | the due time and the escalation target |
| `approval-inbox.service.ts` | the approver's worklist and its SLA column |
| `notification.scheduler.ts` | the overdue sweep |
| `reporting.service.ts` | the approval-ageing report's step name and SLA |
| `document-pdf.service.ts` | the signature blocks |

`WorkflowStepResolver.applicableSteps` keeps its job — deciding which configured steps engage — but
is called **once**, at submit, instead of on every advance. That is the whole change in one
sentence.

## D3. `document.current_step_no` stays the pointer

It is read by the inbox, the reporting rows, the voucher list and the document detail; it already
means "the step this document waits on"; and with route rows keyed by `step_no` it is the natural
key into them. Replacing it with a row id would touch every one of those readers to gain nothing.

`0` keeps meaning "not routing", which `say-who-withdrew-the-document` already relies on.

## D4. Each step gets a start time, and two hand-rolled substitutes disappear

`started_at` is stamped when a step opens — at submit for the first, at advance for the rest.

**The SLA clock.** `sla.service.ts:84` measures every step from `document.submitted_at`, because
that was the only start time in existence. Step 2 inherits whatever step 1 spent, so a slow first
approver leaves step 2 already overdue the moment it opens. `sla_hours` is configured per step; it
has to be measured per step.

**The ageing report's "time in step".** `reporting.service.ts:275` derives it by finding the latest
`approval_log` row at or below the current step and falling back to `submitted_at`. That is an
approximation of `started_at` built out of the only evidence available, and it is wrong for a step
reached by escalation (which logs against the step it *left*) and for the first step of a
resubmission. It becomes a column read.

## D5. The participant set is snapshotted when the step OPENS, not at submit

`stepComplete` resolves principals at the moment of each check, so a `PARALLEL_ALL` step needs one
more approval than it did a minute ago if someone is granted the role mid-step, and can complete on
approvals from people who have since lost it. Neither is a decision anyone made about that document.

The snapshot belongs at step-open, not at submit: between a document being submitted and its third
step opening, a legitimate role change should reach that step. What must not move is the set *while
the step is being approved*.

```
document_approval_step_actor
├─ step_id     → document_approval_step
└─ user_id     the principal expected to act; delegates are still resolved live (one hop)
```

Delegation stays live deliberately: a delegation is a statement about a person's availability
*right now*, and freezing it at step-open would route work to someone who went on leave after the
step opened. The principal is frozen; who may act for them is not.

`PARALLEL_ALL` completes when every recorded actor has approved (directly or through a delegate).
`SEQUENTIAL` and `PARALLEL_ANY` complete on the first approval, unchanged.

## D6. Configuration stops being frozen

`assertNoInFlight` exists because routing read the live step set. It goes — from `addStep`,
`updateStep` and `deleteStep` — because a document that no longer reads configuration cannot be
disturbed by an edit to it. `honour-every-field-the-api-accepts` added the guard to `addStep` one
change ago and said this deletion was coming; this is it.

What replaces it is a property rather than a prohibition: an edit reaches documents submitted
afterwards, and reaches no document already routing. The administrator of a company where documents
are always in flight can finally maintain their workflows.

`workflow_step` rows referenced by a live route are **not** protected from deletion:
`source_workflow_step_id` is nullable and set null on delete, exactly as `approval_log.step_no`
survives a deleted step by being a value rather than a reference. The route row carries its own
copy of everything routing needs.

## D7. A resubmission gets a fresh route, and the old one is kept

`RETURN` puts a document back to `DRAFT`; a rejected one may be revised. On the next submit the
applicable steps are resolved again from current configuration — which is the correct behaviour and
already the specified one — and the previous rows are stamped `superseded_at` rather than deleted.

Each attempt therefore keeps its own record. "Which route did this document run?" has an answer per
attempt, which is what an auditor asks when a document was returned once and approved the second
time under a different chain.

**Known and deliberately not fixed here:** `approval_log` records `step_no` with no notion of
attempt, so a `PARALLEL_ALL` step can still see an approval from a previous attempt when counting
coverage. That is a pre-existing defect of the log's shape, not of the route's, and fixing it means
either an attempt column on `approval_log` (an append-only table this change has no reason to
touch) or counting only rows after the step's `started_at`. The latter is cheap and tempting; it is
left out because it changes what "approved" means for a step, which deserves its own change and its
own scenarios rather than riding along in a structural one.

## D8. The PDF reads the route, so an issued sheet stays the sheet

`document-pdf.service.ts:207` builds the signature blocks from the flagged steps of the live
workflow. Edit the workflow after a document is approved, printed and signed, and re-exporting the
same document produces a different sheet. `payment-batch` already makes this argument about the
exported bank file — "a later edit must not rewrite what an exported batch says" — and the document
carrying handwritten signatures deserves it at least as much.

## D9. Migration, and which transaction the write sits in

One migration adds two tables. **No backfill**: nothing has launched, and a document currently
routing on a live workflow does not exist. A defensive backfill would be code that runs against no
rows and is never tested against real ones.

### The route is written when routing starts, not inside submit's own transaction

Submitting is already two commits, not one:

```
commit 1 — submit()                    commit 2 — start()
  issue the document number              open the first step
  reserve budget / quota                 SUBMITTED → IN_APPROVAL
  status = SUBMITTED                     notify its approvers
        └──── document.submitted ─────────────┘
```

This design first said the route belongs in commit 1, so that a submit produces "a document with
holds and a route, or neither". **That is not reachable, and on inspection not the thing worth
reaching for.**

**Not reachable.** `DocumentRouteService` needs `WorkflowStepResolver` (which steps engage) and
`ApproverResolverService` (who holds the role), both in the approval module — and the approval
module already imports the document module for `releaseDocumentHolds`. Having `DocumentSubmitService`
call into the route service points the second arrow back and the two modules can no longer be
constructed. Moving the route service into the document module reverses the same cycle, because the
two resolvers move with it. The remaining ways out — a CQRS command bus, `forwardRef`, or promoting
both resolvers into a shared module — each introduce a mechanism this codebase does not have, to
buy a guarantee the next paragraph argues is not worth buying.

**Not worth reaching for.** The gap the guarantee would close already exists: today, between the two
commits, a document is `SUBMITTED` with its holds taken and not yet routing. A crash there strands
it exactly as a crash after materialisation would, and `stranded-submit-is-loud.spec.ts` already
pins that this is loud rather than silent. Meanwhile commit 1 holds `SELECT FOR UPDATE` on
`doc_running_number` — the row every concurrent submit in the company queues behind — and on the
budget rows. Materialising there would add a step resolution, a role-holder query and N inserts
inside that lock, slowing every concurrent submit to remove a window that stays open anyway.

**What actually has to hold** is that nobody reads a half-written route. That is guaranteed here:
`start()` writes every route row and opens the first step in one transaction, and only then emits
`approval.step-assigned`. Until that commit the document is in nobody's queue, so there is no reader
to see a partial route.

A resubmission supersedes the previous attempt's rows in the same commit, so a document never has
two live routes.

Advancing a step writes `completed_at` on the row being left and `started_at` on the row being
entered, inside the same `inTransaction` that `act()` already holds the document row lock in — so
the pair moves atomically and a concurrent escalation sweep serialises on the same row as before.

Materialisation writes no `budget_txn` and no `quota_usage`; the reserve calls in commit 1 are
untouched (invariants 4 and 5), and it takes no new lock.

## D10. What this leaves for later

| left out | why | where |
| --- | --- | --- |
| quorum (`min_approvals`, N-of-M) | the column is cheap now; the feature is a policy decision with its own permission questions | its own change |
| ad-hoc approver on one document | inserting a row is now all it takes structurally; who may do it is not decided | its own change |
| escalation that reassigns instead of skipping | needs these rows to record an assignee | `escalate-to-someone-not-past-them` |
| attempt-aware `approval_log` | see D7 | its own change |

## Risks / trade-offs

- **Six readers change at once; one missed reader keeps reading live configuration and the bug
  survives in a corner.** → The greps that produced D2's table are the checklist, and the tasks name
  each file. After the change, `WorkflowStep` may be imported only by configuration code, the
  resolver, and the submit-time materialisation — a grep the tasks make explicit.
- **A route with no applicable steps is now a write that produces nothing.** → `start()` already
  refuses a workflow with no applicable steps, and `stranded-submit-is-loud.spec.ts` pins that it is
  loud. Materialisation happens at submit, so the refusal moves earlier — which is better, and the
  existing test keeps it honest.
- **Two tables where there was none, for data that is mostly a copy.** → That is the point:
  everything this codebase refuses to re-derive (the FX rate, the signature, the exported bytes) is
  stored as a copy for the same reason. A route re-derived from configuration is a route nobody can
  attest to afterwards.
- **`superseded_at` adds a clause every reader must remember.** → It is folded into the single
  lookup helper the six sites share, so forgetting it is a compile-time impossibility rather than a
  discipline.
