# web-accounting

## ADDED Requirements

### Requirement: Undelivered Postings Screen

The web app SHALL provide a screen listing the postings this company owes and has not delivered,
gated by `GL_VIEW`, showing each one's source type, source document number where known, status,
attempt count, last error and last attempt time.

The list holds PENDING and FAILED postings — the two states in which the ledger still owes an
entry.

#### Scenario: The undelivered postings are listed

- **WHEN** a user holding `GL_VIEW` opens the screen
- **THEN** each undelivered posting is shown with its status, attempts and last error

#### Scenario: The attempt count is shown against the bound that stopped it

- **GIVEN** a FAILED posting that exhausted the sweeper's attempts
- **WHEN** it is listed
- **THEN** its attempt count is shown against the maximum, not as a bare number

### Requirement: Re-queue Is Offered Only Where It Can Work

The re-queue control SHALL be offered only on FAILED postings, and only to users holding
`GL_POST_RETRY`. The server refuses to re-queue any other status, so a control offered elsewhere
could only fail.

#### Scenario: A failed posting can be re-queued

- **GIVEN** a user holding `GL_VIEW` and `GL_POST_RETRY`
- **WHEN** they view a FAILED posting
- **THEN** a re-queue control is offered

#### Scenario: A pending posting offers no re-queue

- **GIVEN** the same user
- **WHEN** they view a PENDING posting
- **THEN** no re-queue control is offered, because it is queued rather than stalled

#### Scenario: Viewing without the retry code offers nothing to click

- **GIVEN** a user holding `GL_VIEW` without `GL_POST_RETRY`
- **WHEN** they view a FAILED posting
- **THEN** no re-queue control is offered

### Requirement: A Blocked Period Close Leads to the Postings That Block It

When the period close is refused for undelivered postings, the periods screen SHALL offer a link to
the undelivered-postings screen, and SHALL offer it only to viewers holding `GL_VIEW`, which gates
that screen.

#### Scenario: The refusal offers a way forward

- **GIVEN** a user holding `PERIOD_CLOSE` and `GL_VIEW` whose close was refused
- **WHEN** the refusal is shown
- **THEN** a link to the undelivered postings is offered

#### Scenario: No link the viewer could not follow

- **GIVEN** a user holding `PERIOD_CLOSE` without `GL_VIEW`
- **WHEN** the refusal is shown
- **THEN** no link is offered, and the refusal still names the owed postings

### Requirement: Open Payables Screen

The web app SHALL provide a screen listing the vendor payables this company has accrued and not
paid, gated by `GL_VIEW`, showing vendor, document number, amount, invoice date and due date,
ordered by due date.

Amounts SHALL be formatted with the base currency's `decimal_places` and never carried as a JS
number. The screen SHALL NOT mark rows overdue: the due date is a company-day and the client does
not know the company's timezone.

The endpoint returns every row in one response, so the table SHALL page and sort on the client
rather than requesting pages the server does not honour.

#### Scenario: Open payables are listed by due date

- **WHEN** a user holding `GL_VIEW` opens the screen
- **THEN** the unpaid accruals are listed with vendor, amount, invoice date and due date, ordered by
  due date

#### Scenario: Nothing is marked overdue

- **GIVEN** a payable whose due date has passed in the viewer's timezone
- **WHEN** the screen renders
- **THEN** the row is shown without an overdue marking

### Requirement: Chart of Accounts Screen

The web app SHALL provide a chart-of-accounts screen gated by `COA_VIEW`, with create, edit and
deactivate controls gated by `COA_MANAGE`.

#### Scenario: A reader sees the accounts without the management controls

- **GIVEN** a user holding `COA_VIEW` without `COA_MANAGE`
- **WHEN** the screen renders
- **THEN** the accounts are listed and no create, edit or deactivate control is offered

### Requirement: Journal Screen

The web app SHALL provide a read-only journal screen gated by `GL_VIEW`, listing entries with their
date, source, memo and total, expandable to the lines with each line's account, debit and credit.
Journal entries are produced by the posting engine and are never created from this list.

Entry totals SHALL be summed as decimal strings and formatted with the base currency's
`decimal_places`.

#### Scenario: An entry expands to its lines

- **WHEN** a user holding `GL_VIEW` expands an entry
- **THEN** its lines are shown with account, debit and credit

#### Scenario: An entry sourced from a document links to it

- **GIVEN** an entry carrying a source document number
- **WHEN** it is listed
- **THEN** the document number links to that document

### Requirement: Tax Code and VAT Summary Screens

The web app SHALL provide a tax-code administration screen and a VAT summary screen, both gated by
`TAX_VIEW`.

#### Scenario: Both screens are reachable on the tax read code

- **GIVEN** a user holding `TAX_VIEW`
- **WHEN** they open either screen
- **THEN** the route guard admits them

### Requirement: Financial Statement Screens

The web app SHALL provide trial balance, income statement and balance sheet screens, all gated by
`GL_VIEW`, each with a date filter appropriate to it — a range for the trial balance and income
statement, an as-of date for the balance sheet.

Every figure SHALL be taken from the server as returned; these screens compute no totals of their
own.

#### Scenario: The trial balance filters by a date range

- **WHEN** a user holding `GL_VIEW` sets a from and to date
- **THEN** the trial balance is reloaded for that range

#### Scenario: The balance sheet filters by an as-of date

- **WHEN** the user sets an as-of date
- **THEN** the balance sheet is reloaded as at that date

### Requirement: Account Ledger Drill-Down

The web app SHALL provide an account ledger screen for a single account, gated by `GL_VIEW`,
reached from the trial balance and showing the account's code and name with its lines.

#### Scenario: An account on the trial balance opens its ledger

- **WHEN** the user selects an account on the trial balance
- **THEN** the account ledger for that account opens

### Requirement: Accounting Screens Are Covered by the Smoke Registry

Every routed accounting screen SHALL appear in the view smoke registry, so that a screen which
throws on mount fails a test rather than reaching a user.

#### Scenario: Each accounting screen mounts

- **WHEN** the smoke suite runs
- **THEN** the chart of accounts, journal, journal voucher, undelivered postings, open payables,
  accounting periods, tax codes, VAT summary, trial balance, income statement, balance sheet and
  account ledger each mount without throwing
