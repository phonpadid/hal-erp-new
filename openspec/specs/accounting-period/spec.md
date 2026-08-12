# accounting-period Specification

## Purpose
A company's book months: declared date ranges that can be closed, so a figure cannot enter a month
whose statements have already been printed and acted on. Closing is not a flag — postings run after
their business transaction commits, so a close first establishes that nothing is still owed, and
only then locks. A closed day is refused at the one point every journal entry is constructed, and a
refused posting becomes a queryable, re-queueable failure rather than a lost one. Reopening is
permitted, ordered, separately permissioned and audited. A company that has declared no period is
unaffected in every respect.

This is a soft close: it freezes a period, it does not roll revenue and expense into equity, and it
computes no accruals or revaluations. `fiscal_year` remains a different concept — annual, and
guarding document submission rather than ledger writes.

## Requirements

### Requirement: An Accounting Period Is A Declared Date Range

The system SHALL let a company declare an accounting period as a row carrying `company_id`, the
`fiscal_year` it belongs to, a `code`, `period_start`, `period_end`, and a `status` of `OPEN` or
`CLOSED`. `period_end` SHALL NOT precede `period_start`, and the range MUST fall inside its fiscal
year. Two periods of one company SHALL NOT overlap, so that any date belongs to at most one period.
Gaps between periods SHALL be allowed. A period SHALL never span companies, and periods SHALL never
be read or written across companies (invariant 1). Declaring and editing an `OPEN` period SHALL be
authorized by `PERIOD_MANAGE`, and reading by `PERIOD_VIEW`.

The range SHALL be stored as explicit dates rather than derived from a year and a month. A company
whose books do not run on calendar months cannot express itself otherwise, which is the same reason
`attendance_period` stores its range explicitly.

#### Scenario: A calendar month is declared

- **WHEN** a `PERIOD_MANAGE` user declares a period from the 1st to the last day of a month
- **THEN** the period is stored with status `OPEN`

#### Scenario: A book month that is not a calendar month

- **WHEN** a period is declared from the 26th of one month to the 25th of the next
- **THEN** it is stored exactly as given, because the range is explicit rather than derived

#### Scenario: An overlapping period is rejected

- **GIVEN** a company with a period covering the 1st to the 31st
- **WHEN** another period covering the 20th to the 20th of the following month is declared
- **THEN** it is rejected, because a date would belong to two periods and "is this day closed?"
  would have more than one answer

#### Scenario: A gap between periods is allowed

- **GIVEN** a company with periods for June and August
- **WHEN** July is never declared
- **THEN** both periods stand and no date in July belongs to any period

#### Scenario: A reversed range is rejected

- **WHEN** a period is declared whose `period_end` precedes its `period_start`
- **THEN** it is rejected and no row is created

#### Scenario: Declaring a period is permission-gated and company-scoped

- **WHEN** a request without `PERIOD_MANAGE` declares a period, or a read without `PERIOD_VIEW` is
  made
- **THEN** it is forbidden, and a `PERIOD_VIEW` user sees only their active company's periods

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
rather than silently re-applied. Closing SHALL write no `budget_txn` and SHALL NOT touch any budget
(invariants 3 and 6): the budget and the ledger are separate books, and this closes one of them.

Closing SHALL post the period's accrual for what was received and not invoiced, and its reversal
(see `Closing Accrues What Was Received And Not Invoiced`). Closing SHALL NOT compute anything else:
it does not roll revenue and expense into equity, and it does not revalue foreign-currency balances.
A month can be closed and still be incomplete in the accounting sense, and this requirement says so
rather than leaving the omissions to be discovered.

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

### Requirement: Closing Accrues What Was Received And Not Invoiced

When a period closes, the system SHALL recognise the expense of what the company received and has
not yet been invoiced for, so the month's profit and loss carries what it consumed and its balance
sheet the obligation that created.

The amount SHALL be derived per purchase-order line **received on or before the period's last day**
— by `document_line.last_received_at`, not by when the order was raised, which says nothing about
when the goods arrived. A line whose receipt predates that column, and therefore has no date, SHALL
be included: the goods were received at some unknown past time, so they are outstanding at any
period end, and excluding them would understate silently rather than admit the gap.

The amount SHALL be the quantity received beyond what has been
invoiced against that line, valued at the line's base-currency unit amount
(`budget_base_line_amount / qty`) — the same basis the budget was cut on and the receipt was
costed at, so the accrual, the cut and the eventual invoice are measured alike. Invoiced quantity
SHALL be taken from the disbursement lines that reference the order at the same `line_no`, which is
the link three-way matching already uses.

A line whose `item.is_stock_tracked` is true SHALL be excluded: goods capitalized into `INVENTORY`
at receipt already raised `GRNI`, which is this accrual under another name, and accruing again would
recognise the same purchase twice. A line with no item SHALL be included — a free-text service line
is precisely the case with no other coverage.

The expense account SHALL be resolved from the document that reserved the budget, at the same
`line_no`, because a purchase-order type is ordinarily not budget-controlled and its lines carry no
budget of their own.

The system SHALL post the accrual as one balanced entry dated the period's last day, debiting each
expense account and crediting `ACCRUED_EXPENSE`, and SHALL post its reversal dated the following day
**in the same operation**. A reversal that is a future intention is how the same expense is
recognised twice: the accrual stands in the closed month, the invoice arrives in the next, and
nothing removes the first unless somebody remembers.

Both entries SHALL be keyed to the period, so re-closing cannot post either a second time. A period
whose accrual has already been posted SHALL NOT recompute it: the figure belongs to the close that
computed it, and a changed figure is corrected by reversing and posting a voucher, both of which are
visible and attributed.

A period with nothing received-and-uninvoiced SHALL post nothing at all.

#### Scenario: A service received but not invoiced is accrued

- **GIVEN** a purchase order line for an untracked item, fully received and not yet invoiced
- **WHEN** its period is closed
- **THEN** an entry dated the period's last day debits the order's expense account and credits
  `ACCRUED_EXPENSE` for the received value

#### Scenario: The accrual reverses itself the next day

- **WHEN** a period's accrual is posted
- **THEN** a second entry dated the day after the period's end reverses it exactly, so the invoice
  that follows is recognised once and not twice

#### Scenario: A receipt after the period end is not that period's expense

- **GIVEN** one line received inside the period and another received after it
- **WHEN** the period is closed
- **THEN** only the first is accrued

#### Scenario: A receipt with no recorded date is accrued

- **GIVEN** a received line whose `last_received_at` is null, because it predates the column
- **WHEN** a period is closed
- **THEN** it is accrued, rather than dropped for lacking a date

#### Scenario: A partly invoiced line accrues only the remainder

- **GIVEN** a line received for 10 and invoiced for 4
- **WHEN** its period is closed
- **THEN** 6 units of value are accrued, not 10

#### Scenario: A stock-tracked line is not accrued

- **GIVEN** a received purchase-order line whose item is stock-tracked
- **WHEN** the period is closed
- **THEN** it contributes nothing, because its receipt already credited `GRNI`

#### Scenario: A fully invoiced period accrues nothing

- **GIVEN** a company whose received lines have all been invoiced
- **WHEN** the period is closed
- **THEN** no accrual entry and no reversal is written

#### Scenario: Re-closing does not accrue twice

- **GIVEN** a period that was closed, reopened and closed again
- **WHEN** the second close runs
- **THEN** exactly one accrual entry and one reversal exist for that period

#### Scenario: The accrual leaves the budget alone

- **WHEN** a period's accrual is posted
- **THEN** no `budget_txn` row is written

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

A company that has declared no accounting periods has no final period, and SHALL therefore get no
closing entry and no automatic year close. Its fiscal year keeps whatever status it is given
directly, which posts nothing — the behaviour it has today.

A closed year SHALL NOT be reopened by this capability. Unwinding a closing entry means reversing it
and restating every later year's opening position, which is a deliberate operation and not the
inverse of a period reopen.

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

### Requirement: A Closed Period Refuses New Entries, And A Refused Posting Is Not Lost

The system SHALL refuse to write a `journal_entry` whose `entry_date` falls inside a `CLOSED`
period of that company. The refusal SHALL happen where every entry is constructed, so that no
posting path can bypass it and a path added later is covered by construction.

A refused posting SHALL become a recorded posting failure — queryable on the undelivered-postings
read and re-queueable — exactly as any other failed posting does. It SHALL NOT be silently dropped,
and it SHALL NOT be redirected into a later open period: moving a figure to a month in which it did
not happen is a decision for a person, not for a posting engine.

A date that no declared period covers SHALL be posted normally. A company that has declared no
period is therefore unaffected in every respect.

#### Scenario: An entry dated in a closed period is refused

- **GIVEN** a closed period covering August
- **WHEN** a posting would write an entry dated inside August
- **THEN** no entry is written and the posting fails

#### Scenario: The refusal is visible and recoverable

- **WHEN** a posting is refused because its period is closed
- **THEN** it appears on the undelivered-postings read with the reason, and can be re-queued once
  the period is reopened

#### Scenario: A date in an open period posts

- **WHEN** a posting would write an entry dated inside an `OPEN` period
- **THEN** the entry is written normally

#### Scenario: A company with no periods is unaffected

- **GIVEN** a company that has declared no accounting period
- **WHEN** any posting runs for it
- **THEN** the entry is written exactly as it was before periods existed

#### Scenario: The guard covers every posting path

- **WHEN** a payment settlement, an approval accrual, a claim settlement or a stock movement would
  write into a closed period
- **THEN** each is refused, because all of them construct their entry at the same point

### Requirement: Reopening Is Permitted, Ordered, And Audited

The system SHALL allow a `CLOSED` period to be reopened, returning its status to `OPEN`, and SHALL
require a reason. Reopening SHALL be authorized by `PERIOD_REOPEN`, which SHALL be a different
permission code from `PERIOD_CLOSE`: closing a month is routine and reopening one that has been
reported is not.

A period SHALL NOT be reopened while a later period of the same company is `CLOSED`. Reopening a
month underneath a closed one would let its figures move after the later month's comparatives were
fixed.

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

### Requirement: The Fiscal Years A Period May Be Declared Into Are Readable On The Period Code

The system SHALL expose the active company's OPEN fiscal years, gated by `PERIOD_MANAGE`, so that a
user who may declare a period can choose the year to declare it into without also holding
`FISCAL_YEAR_MANAGE`.

Closed fiscal years SHALL NOT be offered: their result has already been rolled into retained
earnings, so a period declared into one could only be refused.

This read is company-scoped and SHALL NOT mutate anything.

#### Scenario: A period manager can read the years without the organisation code

- **GIVEN** a user holding `PERIOD_MANAGE` and not `FISCAL_YEAR_MANAGE`
- **WHEN** they request the fiscal years available for a period
- **THEN** the active company's open fiscal years are returned

#### Scenario: Closed years are not offered

- **GIVEN** a company with one open and one closed fiscal year
- **WHEN** the available fiscal years are requested
- **THEN** only the open one is returned

#### Scenario: Another company's years are never returned

- **GIVEN** two companies, each with an open fiscal year
- **WHEN** a user in company A requests the available fiscal years
- **THEN** only company A's year is returned

#### Scenario: The read is refused without the period-management code

- **WHEN** a user without `PERIOD_MANAGE` requests the available fiscal years
- **THEN** it is rejected with 403

### Requirement: The Period Log Is Readable

The system SHALL expose a period's append-only log — every declare, close and reopen, each with its
action, the moment it happened, the actor, and the reason where one was given — gated by
`PERIOD_VIEW` and ordered oldest first.

The actor SHALL be reported as an identifier and a username only; the read SHALL NOT return the
actor's other account fields.

Reading the log SHALL be available to anyone who may see the periods themselves, and SHALL NOT
require a code that permits closing or reopening.

#### Scenario: A reopen's reason can be read back

- **GIVEN** a period that was closed and then reopened with a reason
- **WHEN** a user holding `PERIOD_VIEW` reads its log
- **THEN** the reopen entry is present with that reason, its actor and its timestamp

#### Scenario: The log is ordered oldest first

- **GIVEN** a period that was declared, closed, reopened and closed again
- **WHEN** its log is read
- **THEN** the four entries appear in the order they happened

#### Scenario: A newly declared period's log holds its declare

- **GIVEN** a period that has been declared and nothing else
- **WHEN** its log is read
- **THEN** it holds one entry, the declare, carrying the declared range

#### Scenario: The actor is a username, not an account

- **WHEN** a log entry is read
- **THEN** the actor carries an id and a username, and no other account field

#### Scenario: Reading the log needs only the view code

- **GIVEN** a user holding `PERIOD_VIEW` and neither `PERIOD_CLOSE` nor `PERIOD_REOPEN`
- **WHEN** they read a period's log
- **THEN** it is returned

#### Scenario: Another company's period log is not readable

- **GIVEN** a period belonging to another company
- **WHEN** its log is requested
- **THEN** it is not returned

### Requirement: Closing Retranslates Foreign-Currency Payables At The Closing Rate

Closing a period SHALL revalue the company's open payables whose document is denominated in a
currency other than the company's base currency, at the exchange rate in force at the period's end
date, and
SHALL post the difference between the revalued amount and the amount the payable is carried at to
`FX_GAIN` or `FX_LOSS` against `ACCOUNTS_PAYABLE`.

A liability that grows when retranslated SHALL produce a LOSS and a larger payable; one that shrinks
SHALL produce a gain and a smaller payable.

The revaluation SHALL run after the period's postings are drained — the balances are not final
before that — and before the year is closed, because the difference is profit and loss and the year
close sweeps profit and loss into retained earnings.

Payables carried in the base currency SHALL NOT be revalued, and neither `CLAIM_PAYABLE` nor
`ACCRUED_EXPENSE` SHALL be: the first is owed in the company's own money, and the second already
carries its own reversal.

#### Scenario: A rate that rose produces a loss

- **GIVEN** an unpaid payable for 1,000 of a foreign currency, raised at 34 to the unit
- **AND** a closing rate of 35 for the period's end date
- **WHEN** the period is closed
- **THEN** an entry dated the period end debits `FX_LOSS` and credits `ACCOUNTS_PAYABLE` by the
  difference

#### Scenario: A rate that fell produces a gain

- **GIVEN** the same payable and a closing rate of 33
- **WHEN** the period is closed
- **THEN** the entry debits `ACCOUNTS_PAYABLE` and credits `FX_GAIN` by the difference

#### Scenario: A base-currency payable is not revalued

- **GIVEN** an unpaid payable whose document is in the company's base currency
- **WHEN** the period is closed
- **THEN** it contributes nothing to the revaluation

#### Scenario: A paid payable is not revalued

- **GIVEN** a payable whose payment has posted
- **WHEN** the period is closed
- **THEN** it contributes nothing

#### Scenario: A period with no foreign payables posts nothing

- **WHEN** a period with no foreign-currency payables is closed
- **THEN** no revaluation entry is written

### Requirement: The Revaluation Is Reversed The Day After The Period

The revaluation and its reversal SHALL be posted in one operation, the reversal dated the day after
the period ends.

Without it the revaluation would be stranded: a payment clears a payable at the amount its accrual
raised, so the revalued share would remain in `ACCOUNTS_PAYABLE` for good and the account would
drift away from the payables it represents.

Both SHALL be keyed by the period, so re-closing a reopened period is a no-op and cannot post a
second pair.

#### Scenario: The reversal lands the day after

- **WHEN** a period is closed with a revaluation
- **THEN** a reversing entry dated the day after the period end exchanges the same two sides

#### Scenario: The payable returns to its raised amount

- **WHEN** the revaluation and its reversal have both posted
- **THEN** the payable's balance is what its accrual raised, so a later payment clears it exactly

#### Scenario: Re-closing does not revalue twice

- **GIVEN** a period that was closed, reopened and closed again
- **WHEN** the second close runs
- **THEN** exactly one revaluation and one reversal exist for it

### Requirement: A Missing Closing Rate Refuses The Close

The close SHALL be REFUSED when no exchange rate exists for a payable's currency against the base
currency as at the period's end date, naming the currency pair and the date. It SHALL NOT fall back
to the document's locked rate or to skipping the payable.

The rate used SHALL be the latest one in force at or before the period end, which is what a closing
rate is — a company does not publish one for every calendar day.

Each fallback reports a figure at a date nobody chose or understates the liability while appearing
to have revalued it. A refusal is the only outcome that leaves somebody able to act.

#### Scenario: The close names the missing pair

- **GIVEN** an open foreign-currency payable and no rate for its pair at the period end
- **WHEN** the period is closed
- **THEN** it is refused naming the currency and the date, and the period stays open

#### Scenario: Nothing is posted by a refused close

- **WHEN** a close is refused for a missing rate
- **THEN** no revaluation entry exists for that period
