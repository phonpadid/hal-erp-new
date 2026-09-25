## Why

`document.money_moved_on` — the day a recorded expense's money actually left — is write-once at
creation. No route accepts it afterwards: it appears on `CreateDocumentDto` and nowhere else, and
there is no `PATCH` that takes it. The wizard still shows the picker on a reopened draft, restores
the stored day into it, lets the user change it, and reports a successful save. The new day is
discarded between the picker and the request, exactly as the payee, the currency and the supplier
invoice were.

This one is not a dead end — nothing at submit requires the value — which makes it the worse of the
two failures in this pair. The document submits happily and is simply wrong: `money_moved_on` is the
`txn_date` of **every** `budget_txn` row the document writes, at RESERVE on submit and at
ACTUAL/RELEASE on settle (`budget-ledger.service.ts`). A day that cannot be corrected puts the spend
in the wrong period in every budget report that reads those rows, with nothing anywhere saying so.

The DTO's own docblock already names this failure — about the create path, which refuses a bad day
rather than ignoring it:

> Both are refused rather than ignored — **a date silently dropped would put the spend in the wrong
> quarter and look like it worked.**

The create path keeps that promise. The edit path breaks it: it drops a *good* day, silently, and it
looks like it worked.

## What Changes

- The document engine SHALL accept a change to `document.money_moved_on` while the document is
  `DRAFT`, on a route of its own (`PATCH /documents/:id/money-moved-on`), and SHALL reject it once
  the document has left `DRAFT`.
- The change SHALL be held to the same two guards the create path applies: the type's
  `records_past_events` must be set, the day may not be in the future, and a day before today
  requires the `DOC_BACKDATE` permission code. A correction cannot reach further than the creation it
  corrects.
- Clearing the day SHALL be accepted — a document wrongly marked as recording a past event must be
  able to fall back to ledger-dates-by-clock, which is what `NULL` means on this column.
- The web app SHALL send the value on a draft save and SHALL stop offering the picker once the
  document has left `DRAFT`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `document-engine`: a new requirement for correcting a draft's `money_moved_on`, stated separately
  from the type-driven selections because it is not one of them and carries a permission gate none of
  them carry.
- `web-documents`: *Create and Edit a Draft* states that the day-money-moved picker persists on save
  in the edit path and is not offered once the document has left `DRAFT`.

## Impact

Touches **document-engine** (server) and **web-documents** (client), and reaches **budget-control**
only in the sense that it fixes what dates its ledger rows — no budget code changes.

- `back/src/modules/document/dto/document.dto.ts` — a `SetMoneyMovedOnDto`.
- `back/src/modules/document/document.controller.ts` — the new `PATCH` route, `DOC_CREATE`-gated.
- `back/src/modules/document/document.service.ts` — `setMoneyMovedOn`, reusing the existing
  `assertMayStateTheDay` guard rather than restating it.
- `front-end/src/api/documents.ts`, `stores/documents.ts`,
  `views/documents/CreateDocumentView.vue` — the caller and the `DRAFT` lock.

**Invariant 2 (append-only ledgers) is the reason this is `DRAFT`-only and no wider.** A submitted
document has already written `budget_txn` rows carrying this date; those rows are insert-only and
must never be rewritten, so the day is correctable *only before any row exists*. Correcting a
submitted document's dates would mean new compensating rows, which is a different act and is not
proposed here.

**Invariant 6 (locked FX)** is untouched — this is a date, not a rate.

No migration: `document.money_moved_on` exists and is nullable.

Split from `draft-invoice-correctable`, which fixes the same symptom on the same screen but needs no
server change and carries no permission gate.
