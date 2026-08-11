# web-accounting

## ADDED Requirements

### Requirement: Accounting Periods Screen

The web app SHALL provide a screen listing the active company's accounting periods, ordered by
start date, showing each period's code, range and status. The route SHALL be gated by `PERIOD_VIEW`.

Controls SHALL be shown by permission code, mirroring the server: declaring by `PERIOD_MANAGE`,
closing by `PERIOD_CLOSE`, reopening by `PERIOD_REOPEN`. The client guard is UX only; the server
remains authoritative.

#### Scenario: Periods are listed in date order

- **WHEN** a user holding `PERIOD_VIEW` opens the screen
- **THEN** the company's periods are listed with code, start, end and status

#### Scenario: Controls absent without their permission

- **GIVEN** a user holding `PERIOD_VIEW` only
- **WHEN** the screen renders
- **THEN** no declare, close or reopen control is offered

### Requirement: A Refused Close Shows the Server's Reason

The screen SHALL surface a refused close using the server's message as returned, and SHALL NOT
offer a control that closes the period regardless.

The server refuses a close when an earlier period is still open, when the company owes undelivered
postings, or when `RETAINED_EARNINGS` is unmapped on a year's final period. Each refusal names its
obstacle, which is why it is shown rather than translated.

#### Scenario: An earlier open period blocks the close

- **GIVEN** an earlier period is still open
- **WHEN** the user closes a later one
- **THEN** the server's refusal, naming the earlier period, is shown
- **AND** the period remains open in the list

#### Scenario: Undelivered postings block the close

- **GIVEN** the company owes undelivered postings
- **WHEN** the user closes the period
- **THEN** the server's refusal, naming the owed postings, is shown

#### Scenario: No control bypasses a refusal

- **WHEN** the close confirmation is shown
- **THEN** it offers only confirm and cancel, with no option to close despite a refusal

### Requirement: Closing a Year's Final Period Is Announced as Closing the Year

The close confirmation SHALL state that the fiscal year closes with the period, and that reopening
the period will not undo it, when — and only when — the period is the last in its fiscal year.

Closing a year's final period also rolls revenue and expense into retained earnings and closes the
year. That entry is keyed by fiscal year, so a reopen-and-reclose does not repost it; the operator
gets two acts from one control, and can only be told beforehand.

#### Scenario: The final period's confirmation names the year close

- **GIVEN** the period being closed is the last in its fiscal year
- **WHEN** the close confirmation is shown
- **THEN** it states that the fiscal year closes with it

#### Scenario: An ordinary period's confirmation does not

- **GIVEN** the period being closed is not the last in its fiscal year
- **WHEN** the close confirmation is shown
- **THEN** no year-close statement is shown

### Requirement: Reopening Requires a Reason

Reopening SHALL require a non-empty reason, which the server records in the period log. The confirm
control SHALL stay disabled until one is entered.

#### Scenario: Reopen is blocked without a reason

- **GIVEN** a user holding `PERIOD_REOPEN` opens the reopen dialog
- **WHEN** no reason has been entered
- **THEN** the confirm control is disabled

### Requirement: Declaring a Period Names the Fiscal-Year Permission It Needs

The screen SHALL NOT present a fiscal-year selector it cannot populate: when the user holds
`PERIOD_MANAGE` without `FISCAL_YEAR_MANAGE`, it SHALL say the fiscal-year list is unavailable
instead of showing an empty selector.

Declaring a period requires a `fiscalYearId`, and the only endpoint listing fiscal years is gated by
`FISCAL_YEAR_MANAGE` — a different code from `PERIOD_MANAGE`, and one a period-closer need not hold.

#### Scenario: The declare form is usable with both codes

- **GIVEN** a user holding `PERIOD_MANAGE` and `FISCAL_YEAR_MANAGE`
- **WHEN** they open the declare dialog
- **THEN** the fiscal years are selectable and the period can be declared

#### Scenario: The missing permission is named, not hidden

- **GIVEN** a user holding `PERIOD_MANAGE` without `FISCAL_YEAR_MANAGE`
- **WHEN** they open the declare dialog
- **THEN** it states that the fiscal-year list is unavailable rather than showing an empty selector
