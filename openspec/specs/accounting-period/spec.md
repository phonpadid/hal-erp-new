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

Postings run after their business transaction commits, so at the moment of a close there may be work
already committed whose entry is not yet written. Refusing those entries afterwards would lose them;
accepting them would make the close meaningless. Establishing that the period is drained is what
makes the lock honest, and it is the reason this operation is not simply a status change.

The system SHALL also refuse to close a period while an earlier period of the same company is still
`OPEN`. Every financial statement is cumulative, so a month closed out of order fixes figures that
an earlier, still-movable month feeds.

Closing SHALL require `PERIOD_CLOSE` and SHALL be rejected for a period that is already `CLOSED`
rather than silently re-applied. Closing SHALL write no `budget_txn` and SHALL NOT touch any budget
(invariants 3 and 6): the budget and the ledger are separate books, and this closes one of them.

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

The system SHALL record every close and every reopen as an append-only `accounting_period_log` row
carrying the action, the acting user, the instant, and the reason. Log rows SHALL never be updated
or deleted. The period row itself is not a ledger — its status is meant to change — and SHALL remain
editable.

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
