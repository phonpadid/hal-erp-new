# Design

## D1. Withdrawal is an approval action, not merely a status

`cancel()` sets `document.status = CANCELLED` and releases holds. Everything else that ends a
document's route — approve, reject, return — also writes a row in `approval_log` naming its actor,
and that row is what the history renders, what the PDF reads, and what an auditor is handed.

The choice is whether withdrawal joins them or stays a status change with a timestamp. It joins
them, because the questions asked of a withdrawn document are the questions `approval_log` answers
and `document` does not:

| question | `document` alone | with a `CANCEL` row |
| --- | --- | --- |
| who ended it? | infer from `created_by` — but that is the author, not necessarily the actor | stated |
| when? | `updated_at`, which any later write moves | `acted_at`, append-only |
| where in the route? | lost — `current_step_no` stops meaning anything | `step_no`, as it stood |
| why? | nowhere to put it | `remark` |

`created_by` is the strongest argument. Today only the creator may cancel, so inferring the actor
from it happens to work — and it silently stops working the day anyone else may, which is exactly
the kind of inference an audit trail exists to remove.

## D2. `step_no` is `0` for a draft, because that is already what `0` means

`approval_log.step_no` is a non-null int and `document.current_step_no` defaults to `0` until
routing starts. A draft withdrawn before submit is therefore logged at step `0` — the document's own
value, and already the number the codebase uses for "no step reached". No null, no sentinel, no
column change.

A draft's withdrawal interrupts nobody, so it notifies nobody. It is still recorded: the document
existed, held a number from the company's counter, and someone ended it.

## D3. The row and the status commit together; the release stays where it is

`act()` sets the precedent: the log row and the status transition happen inside one
`inTransaction(...)`, and `releaseDocumentHolds` runs after it commits. `cancel()` follows exactly
that shape — a cancelled document whose explanation did not commit would be the silence this change
is removing, reintroduced by a crash.

```
inTransaction:
  load + guard (creator, cancellable status)
  resolve the approvers who are about to lose the item     ← D5
  insert approval_log CANCEL (actor, step_no, remark)
  document.status = CANCELLED
after commit:
  releaseDocumentHolds(documentId)      idempotent, shared with reject
  emit document.cancelled
```

The release is deliberately not pulled into the transaction. It is idempotent, it is the same call
reject makes from outside its transaction, and moving it would change hold behaviour in a change
about recording an act. **No `budget_txn` or `quota_usage` row is written by the new code**: the
release path already in place writes those, unchanged, with its own `em.transactional(...)`
(invariant 4, invariant 5).

## D4. The remark travels with the act

`POST /documents/:id/cancel` takes no body today. It gains an optional `remark`, validated like
every other DTO, and the value lands on the log row. Optional rather than required: a withdrawal is
the author's own second thoughts, and refusing to record the act because no reason was typed would
trade a complete trail for a nagging one.

## D5. Who to notify, resolved before the status changes

After `status = CANCELLED` there is no current step to resolve approvers from, and the inbox filters
on `IN_APPROVAL`, so the item has already vanished. The eligible actors must therefore be read
*before* the transition and carried on the event.

Where that resolution happens is the interesting part. `DocumentSubmitService` lives in the document
module and cannot reach `ApproverResolverService` — the approval module imports the submit service,
so the dependency would be a cycle. The existing decoupling already answers this: submit emits
`document.submitted` and the approval module listens.

So `cancel()` emits `document.cancelled` carrying `{ documentId, requesterId, stepNo, approverUserIds }`,
with the ids resolved inside the transaction through the resolver **the notification module already
depends on** (`notification.scheduler.ts` constructs `ApproverResolverService` today). The listener
that turns the event into notifications sits beside the existing `approval.step-assigned` and
`approval.outcome` handlers in `NotificationEventsListener`.

Resolving inside the document module is still not possible, so the ids are resolved by the listener
— which receives `stepNo` and can load the step itself — rather than by the emitter. The emitter
states what happened; the listener decides who cares.

## D6. Cancelling twice writes one row

`cancel()` already returns early when the document is `CANCELLED`. That early return now also
guarantees exactly one `CANCEL` row and one notification, which matters because the endpoint is a
plain `POST` a client may retry.

## D7. What the reader sees

`CANCEL` gets a label in the three locales beside the actions already there, and an icon/severity in
the detail view's timeline maps — `pi pi-ban`, `secondary`. The timeline is the surface the whole
change exists for; a row the renderer does not recognise would show as a blank line, which is worse
than the silence it replaces.

## D8. What this leaves for later

| left out | why |
| --- | --- |
| letting anyone but the creator withdraw | reject and return already give approvers a way to stop a document, with different meanings; a third would need its own permission and its own argument |
| a withdrawal *request* (asking the current approver's permission) | some systems have it; nothing here needs it while withdrawal is limited to the author's own pending request |
| un-cancelling | `CANCELLED` is terminal; a new document is how a withdrawn request comes back, with a fresh number and a freshly evaluated route |
| notifying anyone beyond the current step's actors | earlier approvers already acted and the outcome does not undo their act; widening the audience is a notification-policy question, not this one |

## Risks / trade-offs

- **Resolving approvers inside the cancel transaction adds queries to a previously trivial path.**
  → One step lookup plus one role-holder query, on an operation a user performs by hand at most once
  per document. The alternative — resolving after commit — reads a document whose step is already
  gone.
- **A listener failure means the log row exists but nobody was told.** → Correct precedence: the
  record is the thing that must not be lost, and every other notification in this system is
  best-effort off an event for the same reason. The row is the evidence; the message is a courtesy.
- **Adding a value to `approve_action` touches a check constraint that was just narrowed.** → The
  same migration shape as `honour-every-field-the-api-accepts` used to remove `DELEGATE`, one change
  earlier. Nothing has launched, so the constraint is restated rather than migrated around.
- **An optional remark means most withdrawals will carry none.** → Still strictly more than today,
  where there is nowhere to put one. If a reason should be mandatory that is a policy decision, and
  it belongs with whoever decides that withdrawal needs approval too.
