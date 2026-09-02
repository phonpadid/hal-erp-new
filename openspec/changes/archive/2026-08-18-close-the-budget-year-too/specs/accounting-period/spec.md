# accounting-period

## MODIFIED Requirements

### Requirement: A Period Closes Only When Its Postings Are Drained

The system SHALL refuse to close a period while the general ledger still owes any posting for that
company. Closing SHALL first ask the undelivered-postings read (see `gl-journal`'s `Undelivered
Postings Are Queryable`), and SHALL reject the close naming what is still outstanding.

The question SHALL be asked for the whole company rather than for the period's date range. An
undelivered posting has no entry and therefore no date in the books: which period it will land in is
knowable only once it is delivered, so a date-bounded question would have to re-derive that date
from the source — outside the one constructor that exists to decide it. Being strict is the honest
reading of "is this month final", and its remedy is to deliver, re-queue, or resolve the outstanding
posting, which is wanted regardless.

The system SHALL also refuse to close a period while an earlier period of the same company is still
`OPEN`. Every financial statement is cumulative, so a month closed out of order fixes figures that
an earlier, still-movable month feeds.

Closing SHALL require `PERIOD_CLOSE` and SHALL be rejected for a period that is already `CLOSED`
rather than silently re-applied. Closing SHALL write no `budget_txn` (invariants 3 and 6): no budget
money moves when a month is closed, and the budget and the ledger remain separate books.

When the period being closed is its fiscal year's last, the system SHALL additionally refuse the
close while any document is still holding a reservation against that year's budgets — a document in
a non-terminal state whose un-released reserve on such a budget is greater than zero
(`Σ RESERVE − Σ RELEASE − Σ ACTUAL`). The refusal SHALL name what is holding the year open, capped
and counted as the undelivered-postings refusal is.

A year whose appropriations are still committed is not finished, and closing over the top of it
produces an expense recognised in one year against another year's appropriation — a difference the
budget-to-ledger reconciliation cannot attribute. The remedy is to complete or cancel those
documents, both of which already exist; the system SHALL NOT resolve them itself, because releasing
them is a lapse policy and moving them is a carry-forward policy, and neither should be decided
silently inside a period close.

Closing SHALL post the period's accrual for what was received and not invoiced, and its reversal
(see `Closing Accrues What Was Received And Not Invoiced`). Closing SHALL NOT compute anything else:
it does not roll revenue and expense into equity, and it does not revalue foreign-currency balances.
A month can be closed and still be incomplete in the accounting sense, and this requirement says so
rather than leaving the omissions to be discovered.

#### Scenario: A year is not closed while its money is still committed

- **GIVEN** the final period of a fiscal year, and a document in approval holding an un-released
  reservation against one of that year's budgets
- **WHEN** the period is closed
- **THEN** the close is refused, naming that document, and the period stays `OPEN`

#### Scenario: A completed or cancelled document stops holding the year open

- **GIVEN** a close refused because one document held a reservation
- **WHEN** that document is cancelled, releasing its hold
- **THEN** the close succeeds

#### Scenario: A period that is not the year's last is not checked for reservations

- **GIVEN** a mid-year period and a document holding a reservation against that year
- **WHEN** the period is closed
- **THEN** the reservation does not block it

#### Scenario: An undelivered posting blocks the close

- **GIVEN** a company with a document whose posting failed and has not been delivered
- **WHEN** a `PERIOD_CLOSE` user closes any of that company's periods
- **THEN** the close is rejected and the response names the outstanding posting

#### Scenario: A drained period closes

- **GIVEN** a company with no undelivered postings and no earlier open period
- **WHEN** a `PERIOD_CLOSE` user closes a period
- **THEN** its status becomes `CLOSED`

#### Scenario: Delivering the posting unblocks the same close

- **GIVEN** a close rejected because a posting was owed
- **WHEN** that posting is delivered and the close is attempted again
- **THEN** it succeeds

#### Scenario: A skipped posting does not block the close

- **GIVEN** a period containing a source that legitimately posted nothing and is recorded `SKIPPED`
- **WHEN** the period is closed
- **THEN** the close succeeds, because a skip is an answer and not outstanding work

#### Scenario: Closing out of order is rejected

- **GIVEN** a company whose July is `OPEN`
- **WHEN** a user closes August
- **THEN** the close is rejected

#### Scenario: Closing twice is rejected

- **WHEN** a `CLOSED` period is closed again
- **THEN** the request is rejected rather than re-applied

#### Scenario: Closing is permission-gated

- **WHEN** a request without `PERIOD_CLOSE` closes a period
- **THEN** it is forbidden and the period stays open

### Requirement: Closing The Year's Final Period Closes The Year

When the period being closed ends on its fiscal year's last day, the system SHALL additionally close
the year: post one balanced closing entry dated that day, and set `fiscal_year.status` to `CLOSED`.
Both SHALL happen **before** the period's own status is set, and both SHALL be part of the same
operation.

The ordering is not a convenience. A closing entry belongs on the year's last day, which falls inside
the period being closed; posting it after that period is closed would be refused by the guard in
`gl-journal`'s `Every Entry Is Written Through One Balanced Constructor`, correctly, because that is
what the guard exists to prevent. Closing the year while its final period is still open is the only
placement that needs no exception — and it makes a year that is left un-closed while all its months
are closed impossible rather than merely unlikely.

The closing entry SHALL debit every revenue account carrying a credit balance for that balance,
credit every expense account carrying a debit balance for that balance, and post the difference to
`RETAINED_EARNINGS`, so the year's revenue and expense begin the next year at zero and its result
stands in equity as a balance rather than as a derivation. Accounts with no activity in the year
SHALL contribute no line.

The entry SHALL be keyed to the fiscal year, so it cannot be posted twice however often the close is
retried. The closing entry SHALL write no `budget_txn` (invariants 3 and 6): a year's result is
accounting, not budget.

Closing the year SHALL additionally set every budget of that fiscal year to `CLOSED`, in the same
operation and before the period's own status is set. An appropriation outlives its year only as a
record: `amount_total` and every `budget_txn` row SHALL be left exactly as they are, and what
changes is that the budget stops being a pot anything can draw on. A year closed on one side of the
house and open on the other is the asymmetry this requirement exists to remove — the ledger
declaring the year finished while its appropriations remain spendable.

`CLOSED` SHALL be distinct from `REJECTED`: one is an appropriation that ran its year, the other a
proposal that was turned down. A `CLOSED` budget SHALL still be readable by every report that asks
what was voted and what was spent, and SHALL NOT be offered as a budget a new document may charge.

A company that has declared no accounting periods has no final period, and SHALL therefore get no
closing entry and no automatic year close. Its fiscal year keeps whatever status it is given
directly, which posts nothing — the behaviour it has today.

A closed year SHALL NOT be reopened by this capability. Unwinding a closing entry means reversing it
and restating every later year's opening position, which is a deliberate operation and not the
inverse of a period reopen.

#### Scenario: Closing the year closes its budgets

- **WHEN** a fiscal year's final period is closed
- **THEN** every budget of that year has `status` `CLOSED`, with `amount_total` and its ledger rows
  unchanged

#### Scenario: A closed budget is no longer offered to a new document

- **GIVEN** a fiscal year whose budgets are `CLOSED`
- **WHEN** a requester asks which budgets a document may charge
- **THEN** none of that year's budgets is offered

#### Scenario: Closing December closes the year

- **GIVEN** a fiscal year whose periods are all closed but the last, which ends on the year's final
  day
- **WHEN** that period is closed
- **THEN** a closing entry dated the year's last day exists, and the fiscal year's status is `CLOSED`

#### Scenario: Revenue and expense start the next year at zero

- **GIVEN** a year holding revenue of 500,000 and expense of 300,000
- **WHEN** its final period is closed
- **THEN** the entry debits revenue 500,000, credits expense 300,000, and credits
  `RETAINED_EARNINGS` 200,000

#### Scenario: A loss is closed the same way

- **GIVEN** a year holding revenue of 100,000 and expense of 180,000
- **WHEN** its final period is closed
- **THEN** the entry debits revenue 100,000, credits expense 180,000, and debits
  `RETAINED_EARNINGS` 80,000

#### Scenario: Closing a period that is not the year's last does not close the year

- **WHEN** a period ending before the fiscal year's last day is closed
- **THEN** no closing entry is written and the fiscal year stays `OPEN`

#### Scenario: A year with no activity closes without an entry

- **GIVEN** a fiscal year whose revenue and expense accounts carry no balance
- **WHEN** its final period is closed
- **THEN** the year is closed and no closing entry is written

#### Scenario: The year is closed once

- **GIVEN** a final period that was closed, reopened and closed again
- **WHEN** the second close runs
- **THEN** exactly one closing entry exists for that fiscal year

#### Scenario: An unmapped RETAINED_EARNINGS refuses the close

- **GIVEN** a company with a year to close and no account mapped to `RETAINED_EARNINGS`
- **THEN** closing the final period is rejected naming the role, and neither the period nor the year
  is closed

#### Scenario: A company with no periods is unaffected

- **GIVEN** a company that has declared no accounting periods
- **WHEN** its fiscal year is closed directly
- **THEN** the status changes and no closing entry is written, exactly as before

### Requirement: Reopening Is Permitted, Ordered, And Audited

The system SHALL allow a `CLOSED` period to be reopened, returning its status to `OPEN`, and SHALL
require a reason. Reopening SHALL be authorized by `PERIOD_REOPEN`, which SHALL be a different
permission code from `PERIOD_CLOSE`: closing a month is routine and reopening one that has been
reported is not.

A period SHALL NOT be reopened while a later period of the same company is `CLOSED`. Reopening a
month underneath a closed one would let its figures move after the later month's comparatives were
fixed.

Reopening a period that is its fiscal year's last SHALL additionally return `fiscal_year.status` to
`OPEN` and every budget of that year to `ACTIVE`, in the same transaction as the reopen. A reopen
that undid the ledger's half and left the budget's half closed would reintroduce the asymmetry from
the other direction, and leave a year that can be posted into but not spent against.

The system SHALL record every declare, every close and every reopen as an append-only
`accounting_period_log` row carrying the action, the acting user, the instant, and the reason. Log
rows SHALL never be updated or deleted. The period row itself is not a ledger — its status is meant
to change — and SHALL remain editable.

A declare's row SHALL be written in the same transaction that creates the period, so that no period
can exist without the record of who declared it, and SHALL carry the declared range as its reason —
the one fact about a declare worth auditing, and one the period row cannot answer for after the
fact.

Periods declared before declares were recorded SHALL NOT be given a fabricated row: their actor is
unknown, and an audit trail whose oldest entries are guesses is worse than one that begins where the
recording began.

#### Scenario: Declaring a period records who declared it

- **WHEN** a `PERIOD_MANAGE` user declares a period
- **THEN** a log row records the declare, the actor, the instant, and the declared range

#### Scenario: A period cannot exist without its declare row

- **GIVEN** a declare that fails after the period row is created
- **WHEN** the transaction resolves
- **THEN** neither the period nor its log row is present

#### Scenario: Reopening the year's final period reopens the year

- **GIVEN** a fiscal year whose final period was closed, closing the year and its budgets
- **WHEN** that period is reopened with a reason
- **THEN** `fiscal_year.status` is `OPEN` again and that year's budgets are `ACTIVE` again

#### Scenario: A period is reopened with a reason

- **WHEN** a `PERIOD_REOPEN` user reopens a closed period with a reason
- **THEN** its status returns to `OPEN` and a log row records the action, the actor, and the reason

#### Scenario: Reopening without a reason is rejected

- **WHEN** a reopen is attempted with no reason
- **THEN** it is rejected and the period stays closed

#### Scenario: Reopening under a closed later period is rejected

- **GIVEN** a company whose July and August are both `CLOSED`
- **WHEN** a user reopens July
- **THEN** it is rejected, because August's figures already depend on July being final

#### Scenario: Closing permission does not grant reopening

- **WHEN** a user holding `PERIOD_CLOSE` but not `PERIOD_REOPEN` reopens a period
- **THEN** it is forbidden and the period stays closed

#### Scenario: The log is append-only

- **WHEN** any code attempts to update or delete an `accounting_period_log` row
- **THEN** the attempt is rejected and the row is unchanged

#### Scenario: Reopening restores writability

- **GIVEN** a posting refused because its period was closed
- **WHEN** the period is reopened and the posting is re-queued
- **THEN** the entry is written with its original date
