# web-accounting

## Purpose

Provide the web UI for the accounting capabilities — the chart of accounts, the journal, and the
financial statements — gated in the client by `GL_*` and related permission codes. This is
client-side UX only; the server remains authoritative for permissions, company scope, and every
figure reported. The client SHALL NOT recompute reported totals.

## Requirements

### Requirement: Balance Sheet Distinguishes Retained Earnings Brought Forward from the Current Period

The balance sheet screen SHALL render both retained-earnings figures the server returns — the
brought-forward balance that closed fiscal years rolled into the equity account
(`retainedEarningsBroughtForward`) and the current period's derived result (`retainedEarnings`) —
and SHALL indicate that the brought-forward figure is already included in the equity rows above it,
so that a reader does not add it to the reported total a second time.

The screen SHALL NOT recompute any total; `liabilitiesEquityTotal` and `balanced` are taken from the
server as returned. Amounts SHALL be formatted with the base currency's `decimal_places` and never
carried as a JS number.

#### Scenario: A company that has closed a year sees both halves

- **GIVEN** a company whose prior fiscal year was closed into retained earnings
- **WHEN** the user opens the balance sheet
- **THEN** the brought-forward figure is shown, labelled as brought forward and marked as already
  counted in the equity rows
- **AND** the current period's figure is shown separately

#### Scenario: A company that has never closed a year sees a zero brought forward

- **GIVEN** a company with no closed fiscal year
- **WHEN** the user opens the balance sheet
- **THEN** the brought-forward figure is shown as zero rather than hidden

#### Scenario: The explanatory note does not claim a close has or has not happened

- **WHEN** the user opens the balance sheet
- **THEN** the note distinguishes the two figures and their relationship to the equity total
- **AND** it makes no claim about whether a period or year close has occurred

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

### Requirement: Journal Voucher Form

The web app SHALL provide a form for posting a journal voucher by hand, gated by `GL_JV_POST`. It
SHALL take an entry date, a memo, and at least two lines of account code, debit, credit and an
optional line memo, and SHALL allow lines to be added and removed.

Amounts SHALL be carried and summed as decimal strings, never as a JS number.

#### Scenario: The form is unreachable without the permission

- **GIVEN** a user who does not hold `GL_JV_POST`
- **WHEN** they navigate to the voucher route
- **THEN** the route guard refuses it

#### Scenario: Lines can be added and removed down to two

- **WHEN** the user edits the voucher
- **THEN** lines can be added, and removed while more than two remain

### Requirement: The Voucher Submit Waits for a Balanced, Non-Zero Entry

The form SHALL show running debit and credit totals as the user types, and SHALL refuse to submit
while the two differ or while both are zero. Each line SHALL carry exactly one non-zero side.

The client check is UX; the server remains authoritative and asserts the balance independently.

#### Scenario: An unbalanced voucher cannot be submitted

- **GIVEN** the debit total and the credit total differ
- **WHEN** the form renders
- **THEN** the submit control is disabled and the imbalance is shown

#### Scenario: An all-zero voucher cannot be submitted

- **GIVEN** every line's debit and credit are zero
- **WHEN** the form renders
- **THEN** the submit control is disabled, because the totals being equal is not enough

#### Scenario: A balanced voucher can be submitted

- **GIVEN** the debit total equals the credit total and both are non-zero
- **WHEN** the form renders
- **THEN** the submit control is enabled

#### Scenario: A line with two non-zero sides is rejected before posting

- **GIVEN** a line carrying both a debit and a credit
- **WHEN** the form renders
- **THEN** the submit control is disabled and the line is marked

### Requirement: A Resubmitted Voucher Posts Once

The form SHALL send a client-generated voucher id, so that submitting the same voucher twice — a
double-click, or a retry after an uncertain response — resolves to one entry rather than two. A new
id SHALL be generated only after a successful post.

#### Scenario: The same form submitted twice sends one id

- **GIVEN** a filled-in voucher
- **WHEN** it is submitted twice
- **THEN** both requests carry the same id

#### Scenario: A fresh voucher gets a fresh id

- **GIVEN** a voucher was posted successfully
- **WHEN** the operator begins another
- **THEN** it carries a different id

### Requirement: Reversal Is Offered on Journal Entries

The journal SHALL offer a reverse control on its entries to users holding `GL_JV_POST`, taking an
optional date and memo. It SHALL be offered on every entry, not only on manually posted ones, since
a wrong automatic posting is the likelier thing to correct.

#### Scenario: The control is absent without the permission

- **GIVEN** a user holding `GL_VIEW` without `GL_JV_POST`
- **WHEN** the journal renders
- **THEN** no reverse control is offered

#### Scenario: Automatic postings can be reversed too

- **GIVEN** an entry whose source is not a manual voucher
- **WHEN** a user holding `GL_JV_POST` views it
- **THEN** the reverse control is offered

### Requirement: The Reversal Dialog States Its Date and Its Once-Only Rule

The reversal dialog SHALL state that a reversal is dated today by default rather than on the
original entry's date, and that an entry can be reversed at most once. A refusal from the server —
including an entry already reversed — SHALL be shown as returned.

#### Scenario: The default date is explained

- **WHEN** the reversal dialog is opened
- **THEN** it states that the reversal is dated today unless a date is given, and why

#### Scenario: A second reversal is refused by the server and shown

- **GIVEN** an entry that has already been reversed
- **WHEN** the user reverses it again
- **THEN** the server's refusal, naming the existing reversing entry, is shown
