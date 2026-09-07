## Context

`BudgetLedgerService` is the one place a `budget_txn` row is written, and its `insertTxn` takes
`txnDate` as a required parameter — deliberately, with a comment saying a default of "today" would
be "silently wrong for a transfer whose movement states an effective day". Above it, `reserveIn`
computes that day as `companyDayFor(tem, documentId, new Date())`: the company's day at the instant
of the write. Every caller of the submit path therefore gets "today", and there is no field anywhere
between the screen and that call that could say otherwise.

`document` carries no date the user sets. It has `submitted_at`, `approved_at`, `created_at` — all
stamped by the system — and `vendor_invoice_date`, which describes a supplier's paper and never
reaches the ledger. `document_type` carries eight `requires_*`-style flags and no notion of a type
that records history.

`import:spend-history` already writes correctly-dated history through the same ledger, passing the
first of each month. So the capability exists at the bottom of the stack and is missing at the top.

The customer has decided to enter FY2026 months 1–7 by hand rather than by import. Entered as the
system stands, 108,004,000 of Q1–Q2 spending would be reported in Q3.

## Goals / Non-Goals

**Goals:**

- A person entering something that already happened can say when it happened, and the quarterly
  report agrees with the workbook.
- Ordinary daily work is untouched: every type in use today keeps stamping the day of the click,
  with no new field on its form and no new way to get it wrong.
- Backdating is a distinct, granted, visible act rather than a side effect of data entry.

**Non-Goals:**

- Backdating the approval trail. `submitted_at` and `approved_at` stay honest — the system says when
  it was told, the person says when it happened.
- Reconstructing a past balance to authorise a past-dated reservation. Discussed under Decisions.
- Editing the day after the fact. `budget_txn` is append-only; a wrong day is answered with a
  compensating entry, which is the existing correction path and not a new one.
- Making hand entry pleasant. 532 plan lines across 12 months is an importer's job; this change
  makes hand entry *correct*, not cheap.

## Decisions

### The day lives on the document, and the ledger reads it there

`insertTxn` keeps its required `txnDate` parameter. What changes is one line above it: the day comes
from the document when the document states one, and from the clock when it does not.

*Alternative considered — pass the day down from each caller.* Rejected. `budget_txn` has one insert
point precisely so that a rule cannot be bypassed by a call site; a day threaded separately through
submit, settle and release is a day one of those three forgets, and the failure is silent.

Settlement and release read the same day for the same reason: a March spend settled in March should
not produce an `ACTUAL` in Q3 beneath a `RESERVE` in Q1.

### The flag is on the type, not on the document

A per-document choice would let any requester decide that today's disbursement belongs to March.
A type flag makes it a configuration decision, made once by whoever configures document types, and
it leaves an artefact worth having: documents that record history are told apart from documents that
made it, forever, by their type — the same property `SPEND_HIST` gives the importer's output.

### The balance check uses today's balance, never the stated day's

`BudgetBalanceService` can compute a balance as of a date (`balanceAt`, `breakdownAt`), so
authorising a backdated reservation against the balance *as it stood then* is possible. It is
refused anyway: two documents backdated to January would each see a January balance that neither had
consumed yet, both pass, and the budget would end up over-committed with no single row at fault. The
money either exists now or it does not. A day says when it moved, not how much there was.

### Three guards, checked before the first row

Inside the fiscal year of every budget charged; not in the future; not inside a closed accounting
period. Checked together, before any write, naming which rule was broken.

The closed-period guard is the one that will matter later rather than now — the company has no
accounting periods yet. It is in this change rather than deferred because `accounting-period`
already states that a closed period refuses new entries, and shipping a backdating feature that can
reach behind that lock would put the two specs in contradiction from the first day.

### The permission is new, not an existing one reused

`DOC_BACKDATE`, declared beside the other document codes and synced by `permissions:sync`.
Reusing `DOC_CONFIG_MANAGE` would tie backdating to whoever configures document types, and reusing
`BUDGET_MANAGE` would tie it to whoever sets budgets; neither is the same question, and both grant a
great deal more than the right to state a date.

## Sequence: what writes `budget_txn`

Unchanged in shape; the day is the only new input.

1. Submit, inside one `em.transactional(...)`: lock the governing `budget_control_point` rows in
   ascending id order (the module's one lock class), run the ancestor-hold check, then write one
   `RESERVE` per budget through `insertTxn`.
2. The day passed to `insertTxn` is the document's stated day when it has one, else
   `companyDayFor(..., new Date())`. The three guards run before the lock is taken, so a refused day
   costs nothing and holds nothing.
3. Settlement writes `ACTUAL` and, where the settled amount is lower, `RELEASE` — both carrying the
   same day, in the same transaction, under the same locks.
4. Reject or cancel releases what was reserved, carrying the same day, as it does today.

No new lock, no new transaction boundary, no change to the order in which existing locks are taken.

## Risks / Trade-offs

- **[A backdated row cannot be corrected]** → append-only, so a day entered wrongly is answered only
  by a compensating entry. Mitigation: the three guards, the permission, and the day being visible
  on the document and its ledger rows. There is no undo to build; there is only refusing the wrong
  day before it is written.

- **[Backdating becomes a habit rather than a migration step]** → the type flag limits it to types
  configured for it, but nothing stops someone flagging an ordinary disbursement type later.
  Mitigation: the flag is visible on the document-type screen and the permission is separate; both
  are readable by anyone auditing who can move money between quarters.

- **[The quarterly report becomes moveable]** → this is the honest cost of the customer's decision.
  Anyone holding `DOC_BACKDATE` can decide which quarter a spend falls in. Before this change the
  answer was fixed and wrong; after it, it is stated and auditable. Mitigation: grant the permission
  narrowly — the budget office, not every requester.

- **[Two dates on one screen confuse the reader]** → a document will show "submitted today" beside
  "money moved in March". Mitigation: label the field for what it is (the day the money moved), and
  show it only on types that record past events, where the distinction is the point.

## Migration Plan

1. Migration adds `document_type.records_past_events` (boolean, default false) and
   `document.<stated day>` (date, nullable). Both defaults preserve today's behaviour exactly, so
   deploying the migration alone changes nothing.
2. Deploy the backend; run `pnpm --filter back permissions:sync` so `DOC_BACKDATE` exists as a row —
   without it the guard rejects everyone, including whoever should hold it.
3. Grant `DOC_BACKDATE` to the role that will enter the history.
4. Configure the type that records the past, and enable it for the departments that will use it.

Rollback is a revert plus leaving the two columns in place: a nullable date and a false-defaulting
boolean are inert to the previous code.

## Open Questions

- What is the field called on screen? "ວັນທີ່ເງິນອອກຈິງ" (the day the money actually left) reads
  clearest in Lao, but the customer's own wording should win.
- Should a backdated document be barred from the reference chain (`ref_document_id`) — i.e. can a
  historical entry be the predecessor of a live purchase order? Nothing in this change forbids it,
  and nothing yet needs it.
