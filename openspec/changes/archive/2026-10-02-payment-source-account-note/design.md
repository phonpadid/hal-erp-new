## Context

`payment` already records how money moved (`method`: CASH or TRANSFER), an external `reference`, a
`note`, and — for a payment produced by a bank run — the `bank_account_id` the run named. What it
does not record is which account a HAND-recorded transfer came out of, and the company runs more than
one.

The obvious answer is the one the `payment-handoff` spec already reaches for: let a singly-recorded
payment name a configured `bank_account`. That requirement exists and is not implemented, and the
reason it cannot be implemented now is data, not code — `bank_account` holds zero rows in the live
database, so a picker would offer an empty list and block finance behind a master-data project they
have not started.

## Goals / Non-Goals

**Goals:**

- Record whether a transfer left the main or the reserve account, as a confirmation at the moment of
  paying.
- Ask it of a transfer only.
- Let finance edit the actual rate rather than retype it, by starting from the rate the document
  locked at submit.

**Non-Goals:**

- Entering the company's bank accounts as master data, or wiring `payment.bank_account_id` from this
  form. That stays open, and this change is deliberately shaped not to get in its way.
- Reconciliation, balances, or anything derived from the typed number. It is text.

## Decisions

### D1 — Text with a CHECK, not a foreign key

`transfer_from` is a closed pair (`PRIMARY` / `RESERVE`) stored as text with a CHECK, in the shape
`method` and `post_action` already use. A foreign key would demand the master data this change exists
to avoid depending on — `bank_account` holds no rows, so a picker would offer an empty list.

The payee's account number is NOT captured here. The requester names the destination on the document
and the queue already carries it; a second copy typed by finance would disagree with the first the
day somebody mistyped one.

The cost is stated rather than hidden: "the reserve one" is a claim by a person, not a link to a
configured account, so `unattributed()` keeps counting these payments. That report exists to say
"cash left and nobody said from where in a way the books can use", and this text does not change that
answer.

### D1b — Asked on the SLIP, and adopted by the payment

The column is on `payment_attachment` as well as `payment`, and the slip's is the one people fill in.

This follows the order of events in the business rather than the order of rows in the schema. The
money goes out; finance attaches the transfer slip at the approval step that demands one; the payment
is recorded afterwards, sometimes days afterwards, by whoever clears the queue. The moment somebody
can truthfully say which account paid is the first of those, and at that moment there is no `payment`
row — a slip attached mid-approval exists precisely because the document is not payable yet. The slip
is what can carry the answer.

`PaymentService.record` then adopts it, the same way the payment already adopts the slip itself: the
request's own value wins if it has one, otherwise the newest slip that states one. So the question is
asked once, where it can be answered, and the ready-to-pay row carries the answer forward
(`statedTransferFrom`) so the record form arrives with it filled in rather than asking again.

The alternative — asking only on the record-payment screen — was what shipped first and was wrong for
this company: the person clearing the payment queue is not the person who made the transfer, and
asking them produces a guess. Two columns is the cost of asking the right person.

### D1c — The flow ends at the slip: the payment records itself

The record-payment screen is no longer a step anyone walks through. When a document completes and
becomes payable, `payment.ready` already fires; a listener records the payment from what the slips
state and the document never reaches the queue.

It cannot happen at the moment of upload, which is where the business would put it: the slip is
attached mid-approval, and a `payment` row requires a COMPLETED, owed document. Completion is the
first instant the row can exist, and by then nothing more needs to be asked.

Three properties make this safe to hang off an event:

- **It goes through `record`.** Not around it — the owed predicate, the period guard, the FX maths
  and the `payment.settled` emit that drives GL posting are that method's business, and a second way
  to write a payment row is a defect this module already removed once.
- **It records only a complete statement, and only once.** Both the account and the rate, or nothing;
  and an existing payment makes it a no-op, because completion can be signalled more than once.
- **Every failure falls back to the old behaviour.** A half-stated slip, an existing payment, a
  refusal, an exception — all leave the document in the ready-to-pay queue for a person, which is
  exactly what shipped before. The listener logs and never propagates: the approval is committed and
  must not be disturbed by what happens after it.

What is lost is the record form's other fields on this path — withholding tax, a bank reference, and
the CASH method. That is deliberate and checked against the live data: of the payments recorded so
far, none carries a WHT code, none a reference, and none is cash. A document that does need them is
one whose slip did not state both facts, so it still arrives at the form.

### D2 — Asked for a transfer, not for cash

Cash left no bank account. Asking anyway produces a column full of whatever was in the field when the
form was submitted, which is worse than an empty column: the next reader cannot tell a real answer
from a leftover one. The server enforces the pairing (a transfer must carry both, cash must not be
required to) so a client that forgets is refused rather than storing a half-answer.

### D3 — The rate is stated on the slip, pre-filled from the document, never defaulted by the server

The rate is asked where the account is asked, and for the same reason: the bank's rate for that day
is on the slip in the hand of whoever paid, and nobody clearing a queue a week later can recover it.

The field starts at the document's locked rate and is editable. The server records what was submitted
and substitutes nothing — a rate the server filled in would be the system claiming to know what the
bank did — and refuses when neither the request nor any slip states one. Pre-filling only spares the
person retyping a figure the document already carries, which is where a digit gets dropped.

Carrying `lockedRate` on the queue row is what lets the fallback form do the same; the queue reports
it as stamped and never recomputes it (invariant 6).

### D4 — Radio buttons, not a select

Two options that a person is confirming rather than searching. Both visible at once is what makes it a
confirmation; a dropdown defaulting to "main" would be answered by not answering.

### Budget, quota, and transaction boundaries

Nothing here writes a ledger row. The column is written in the same `payment` insert the record
already performs, inside the transaction it already opens; no lock, no `budget_txn`, no `quota_usage`.

## Risks / Trade-offs

- **Two ways to say which account paid** (`bank_account_id` from a batch, the choice stated on a
  slip) → the read surfaces show both, and the spec states plainly that the choice does not attribute
  a payment to a configured account.
- **The same facts on two tables** (`payment_attachment.transfer_from` / `actual_rate`,
  `payment.transfer_from` / `actual_rate`) → they cannot disagree by accident, because only one
  direction is ever written: the payment reads the slip, never the reverse. A payment recorded with
  its own values keeps them, which is the intended override.
- **A payment written by a listener rather than a person** → it writes only what a `PAYMENT_MANAGE`
  holder already stated on the slip, only when that statement is complete, at most once, and it falls
  back to the manual queue on any failure. The log line names what it recorded.
- **A pre-filled rate is accepted without being read** → accepted deliberately: for a document in the
  base currency the locked rate IS the right answer, and for a foreign-currency one the figure is
  visible in the field the person is about to submit.
- **A company with one account still has to choose main or reserve** → one radio click, and the
  answer is meaningful the day they open a second account.

## Migration Plan

1. Ship the nullable columns; every existing payment and slip reads as null, which is what "nobody
   stated it" looks like.
2. The form asks for it on the next transfer recorded. No backfill: nobody can now say which account
   paid a transfer recorded last month.
3. Rollback drops both columns; nothing else reads them.
