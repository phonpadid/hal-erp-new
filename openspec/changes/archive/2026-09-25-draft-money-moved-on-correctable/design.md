## Context

`money_moved_on` is set once, in `DocumentService.create`, guarded by `assertMayStateTheDay` — which
enforces three things: the type's `records_past_events`, no future day, and `DOC_BACKDATE` for any
day before today. Nothing writes the column again. It appears on `CreateDocumentDto` and on no other
DTO, and the controller exposes no route that takes it.

Downstream it is load-bearing. `BudgetLedgerService` reads it as the `txn_date` for every ledger row
the document writes:

```ts
if (document?.moneyMovedOn) return document.moneyMovedOn;
```

So the column decides which period a RESERVE, an ACTUAL and a RELEASE land in. `NULL` means
"date the ledger by the clock", the ordinary behaviour.

On the client, `headerFields` restores it and the picker is rendered for a `records_past_events` type
with no `:disabled`, so the user can change it on a reopened draft — and the change is dropped,
measured directly: the four arguments `saveDraft` receives contain no `moneyMovedOn`.

## Goals / Non-Goals

**Goals:**

- A `DRAFT` document's `money_moved_on` can be corrected, under the same three guards the creation
  was held to.
- The value can be cleared, back to ledger-dates-by-clock.
- The web app sends it, and stops offering the picker where the server refuses the change.

**Non-Goals:**

- Correcting a submitted document's day. Its ledger rows exist and are append-only (invariant 2);
  moving them would mean compensating rows, which is a separate act with its own approval story.
- Re-dating existing `budget_txn` rows. Nothing in this change touches the ledger.
- Folding this into the selections route — see below.

## Decisions

**A route of its own, not `PATCH :id/selections`.**
The selections route's own docblock says why the selections travel together: they are *"chosen on one
wizard step"* and *"some of them are checked against each other"*. Neither is true here — the picker
is on the lines step, and the day is checked against the calendar and the caller's permissions, not
against a sibling field. More decisively, this is the only draft-header correction that can be
refused with **403**: `assertMayStateTheDay` throws `ForbiddenException` without `DOC_BACKDATE`.
Folding a permission-gated field into a route whose other members are not permission-gated makes one
endpoint answer with two different meanings of "no". The codebase's own shape is one route per
concern — *"there is no general update — fields, lines, payee and invoice each have theirs"* — and
this is a concern.

The currency went on `selections` for the opposite reasons: same wizard step as the vendor and payee,
no extra permission, no guard beyond "is it an active currency".

**Reuse `assertMayStateTheDay`, do not restate it.**
The create path's guard is exactly the rule a correction must obey, and the failure mode of restating
it is that the two drift — which is the disease this whole series of changes is treating. The method
is already `private` on the service and takes `(day, docType, timezone)`; `setMoneyMovedOn` loads the
document's `documentType` and its company's `timezone` and calls it.

`getWith` does not populate relations, so the correction path loads the type and company explicitly
rather than assuming a populated reference.

**Clearing is allowed; the currency's argument does not carry over.**
An explicit `null` is accepted here, unlike the currency. Clearing a currency restates every line
amount in a different unit; clearing this day just returns the ledger to dating by the clock, which
is what most documents do and what this column's `NULL` already means. A type that loses
`records_past_events` leaves its drafts holding a day they may no longer state — those need to be
able to drop it.

Clearing is NOT subject to `assertMayStateTheDay`: there is no day to be in the future and no past
day to backdate. Requiring `DOC_BACKDATE` to *remove* a date would strand exactly the drafts the
previous paragraph describes.

**Send it on every draft save, like the invoice.**
Same reasoning: the picker is conditional on `records_past_events`, the ref is restored from the
document, and gating the send on visibility would clear a stored day as a side effect of an unrelated
edit.

## Risks / Trade-offs

**A correction moves which period the spend will report in.** That is the point, but it means one
draft edit changes a budget figure's period. → Only before submit, so no `budget_txn` row exists yet
to move; the first rows are written at submit from whatever the document then holds. Nothing is
rewritten, so invariant 2 is never approached.

**`DOC_BACKDATE` is now checkable on a second path.** → It is the same guard function, called with
the same arguments, so the two paths cannot disagree by construction. A test asserts the refusal on
the correction path specifically.

**One more request per draft save**, now three header writes plus fields and lines. → Small, local,
and the alternative is a general update endpoint that this codebase has deliberately avoided.

## Migration Plan

None. `document.money_moved_on` exists and is nullable; no backfill. Existing drafts become
correctable. Rollback is reverting the code — a corrected draft is indistinguishable from one created
with that day.

## Budget and quota sequencing

This change writes neither `budget_txn` nor `quota_usage` and takes no lock: `setMoneyMovedOn` is a
single `em.flush()` on one `document` row, refused outside `DRAFT`.

Its whole purpose, though, is a value the budget ledger later reads. The sequencing that matters is
that the correction happens **strictly before** any ledger row exists: submit is what writes the first
RESERVE, under `BudgetLedgerService`'s existing `PESSIMISTIC_WRITE` control-point locks, and it reads
`money_moved_on` from the document at that moment. So a corrected draft reserves against the corrected
period, and a document that has already reserved cannot be corrected at all. No new transaction
boundary and no new lock.

## Open Questions

None.
