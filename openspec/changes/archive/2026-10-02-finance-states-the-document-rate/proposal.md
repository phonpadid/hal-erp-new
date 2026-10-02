## Why

The business pays before the document finishes approving, and nobody can tell the system what they
paid at.

On document type `REC` the route is `xone → budget_officer → finance_head (requires a transfer slip)
→ anousone (accounting)`. Finance moves the money at step 3, attaches the slip, and accounting's
step-4 approval ends the process. But the document's rate was decided at **submit**, from the
company-wide rate table as of that date, and stamped on `document.exchange_rate`. The person who
actually converted the money has no way to say what the bank gave them — their only lever is the
rate table, which changes every later document too.

What that costs, observed on `REC-HAL-2026-0002`:

```
RESERVE  2,300,000   submitted 100 USD @ 23000
RELEASE  2,300,000   returned so the rate could be corrected
RESERVE    300,000   resubmitted 10 USD @ 30000 — the table's newest row won
ACTUAL     300,000
```

Finance wanted this document at 23000. They typed 23000 into the slip panel's rate field and it went
nowhere: that value only travels as part of a multipart slip **upload**, so with no new file attached
nothing was stored, and the only attachment still reads 30000. The budget was charged 300,000 for a
purchase finance says cost 230,000, and the workaround — return, resubmit, hope the table says the
right thing that day — moves the rate for every other document in flight.

## What Changes

- The rate finance states while attaching the transfer slip **restates the document**:
  `exchange_rate`, `base_total_amount`, and each line's `base_line_amount`.
- The budget hold follows it: the existing reservation is released and a new one taken at the new
  amount, through the same services and the same control-policy check, so an over-budget re-rate is
  refused rather than absorbed. Append-only throughout — `RELEASE` + `RESERVE` rows, never an update.
- **BREAKING (spec-level)**: `multi-currency`'s *Locked Rate on Document* narrows from "never
  recomputed" to "never recomputed **from current rates**, and restated only by a person, only while
  an approval step remains". A document nobody can still refuse is untouchable exactly as before.
- Restating is refused once the last approval is given, once a payment exists, or outside
  `IN_APPROVAL`. Somebody always signs the final figure — on this route, accounting at step 4.
- Every restatement writes an `approval_log` row: who, from what rate to what rate, when. The
  approvals already given stay visible against the figure they were given on.
- The rate becomes editable **on its own**, without re-attaching a file. That trap is what silently
  discarded finance's 23000.
- The budget basis is left alone when a `BUDGET_RATE` row exists, and moves with the daily rate when
  none does — the same fallback the submit path already applies, so restating cannot quietly change
  which rate governs the budget.

Deliberately NOT in this change:

- **Already-completed documents.** `budget_txn` is append-only (invariant 2) and the approvals are
  spent. Correcting one needs a reversing document, which is its own change.
- **The company-wide rate table.** It stays what it is: the default a document starts from.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `multi-currency`: *Locked Rate on Document* narrows to allow one person-stated restatement while
  the document can still be refused; the daily rate and the budget basis are stated separately.
- `budget-control`: a re-rate releases and re-reserves under the existing coverage and over-limit
  rules, with the same lock discipline as *Concurrency-Safe Reservation*.
- `payment-handoff`: the slip is where the rate is stated — the capability that already owns it —
  and stating it now restates the document, under conditions that keep a signature on the final figure.
- `web-payments`: the slip panel offers the rate as an editable figure in its own right, says what
  restating will do before it is done, and stops offering it when it would be refused.

## Impact

- **Data model**: none. No new column — `document.exchange_rate`, `base_total_amount`,
  `document_line.base_line_amount` and `budget_txn` already hold everything.
- **Backend**: a re-rate operation (document + lines + budget + `approval_log`) in one transaction
  under the reservation's lock; `PaymentAttachmentService` calls it; a route to state the rate
  without a file; `PaymentService.record` keeps adopting the slip's rate, which will now always match
  the document's.
- **Frontend**: `PaymentSlips.vue` — the rate as its own field with its own save, the effect stated
  before it is applied, and the whole control withdrawn once no approval step remains.
- **Depends on**: change `payment-source-account-note` (implemented, not yet archived), which put the
  rate and the paying account on the slip in the first place.
- **Invariants**: 6 is narrowed deliberately and the narrowing is stated in the spec, not implied. 2
  and 3 are untouched — the ledger only ever gains rows and every balance stays derived. 8 is
  unaffected: approval routing bands compare against the budget base, so with a `BUDGET_RATE`
  configured no approver's authority band moves under them.
