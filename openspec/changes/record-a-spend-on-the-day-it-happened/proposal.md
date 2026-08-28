## Why

The customer's FY2026 spending for months 1–7 happened outside this system. They have decided to
enter it by hand through the application rather than by import. Entered today, every kip of it
lands in Q3: `BudgetLedgerService.reserve` stamps `txn_date` with
`companyDayFor(tem, documentId, new Date())` — the day of the click, with no way for the person
clicking to say otherwise. The quarterly report reads `txn_date`, so Q1 and Q2 would show zero
against months that consumed 108,004,000, and the year would be right only in total.

`txn_date` already means "the day of the event" — `budget-control` says so where it defines the
ledger read. The gap is not in the ledger, which requires its caller to state a date and refuses to
default one; it is that nothing between the screen and that call can carry a date. `import:spend-history`
passes the first of the month and gets this right today; a person cannot.

## What Changes

- A document type MAY declare that it records something that already happened. On such a type, and
  only such a type, the document carries the day the money moved.
- The budget ledger takes `txn_date` from that day when the document states one, and from the day
  of the click when it does not. Every document type in use today states none, so nothing about
  ordinary work changes.
- Stating a past day requires a new permission, `DOC_BACKDATE`. A requester who may raise the
  document may not silently move money between quarters.
- The day is refused unless it falls inside the document's fiscal year, is not in the future, and
  is not inside a closed accounting period.
- The day is shown on the document and carried into the ledger row, so a reader can see which
  entries were dated by hand and which by the clock.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `document-engine`: "Configurable Document Type" gains a flag declaring that a type records
  something that already happened, and a document of such a type carries the day it happened.
- `budget-control`: the day a `budget_txn` row is stamped with becomes the document's day where the
  document states one, instead of always the day of the write.
- `rbac`: a permission code is added to the catalogue the guards check. No requirement of the
  capability changes — codes are declared in TypeScript and synced by `permissions:sync` — so this
  is listed for the reader, not as a delta.

## Impact

- **Capabilities touched**: `document-engine`, `budget-control`. `accounting-period` is read from,
  not changed: its "A Closed Period Refuses New Entries" requirement becomes one of the three
  guards on the date.
- **Invariant risk**: INVARIANT 2 (append-only) is why this must be right the first time — a row
  written with the wrong day can only be answered with a compensating entry, never corrected.
  INVARIANT 4 (reserve → actual → release) is unaffected: the sequence is unchanged, only the day
  stamped on each row.
- **What does NOT change**: the approval trail. A backdated document is still submitted, approved
  and stamped `submitted_at` / `approved_at` at the real clock time. Only the money's day is stated
  by the user — what happened in the system stays honestly dated by the system.
- **Migration**: `document_type` gains a boolean, `document` gains a nullable date. Both default to
  today's behaviour, so existing rows and existing types are unaffected.
- **Code**: `document.entities.ts`, `CreateDocumentDto` / update DTO, `document-submit.service.ts`,
  `budget-ledger.service.ts` (`reserve`, and the settlement path that writes `ACTUAL`), the
  document-type form and the create-document form in the web app, and `permissions.ts`.
- **Operational**: this does not make hand entry cheap. The workbook holds 532 plan lines across 12
  months; the importer does that in one command. This change makes hand entry *correct*, which is a
  different thing from making it advisable.
