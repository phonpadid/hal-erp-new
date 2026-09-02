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

## ADDED Requirements

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
