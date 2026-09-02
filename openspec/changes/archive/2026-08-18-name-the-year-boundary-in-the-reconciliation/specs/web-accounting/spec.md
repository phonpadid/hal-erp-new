# web-accounting

## MODIFIED Requirements

### Requirement: A Screen Reconciles the Budget Against the Ledger

The web app SHALL provide a budget-to-ledger reconciliation screen for a chosen fiscal year, gated
by the reporting permission, showing per account what the budget says was appropriated, committed and
consumed, what the ledger says moved, and the difference.

Each account's difference SHALL be expandable into the causes the server named, and the
**unexplained** remainder SHALL be shown on the row itself rather than only inside the expansion —
it is the one figure the screen exists to surface, and a number that has to be opened to be seen is
a number nobody sees.

Where the server named the documents behind a cause, the expansion SHALL name them too. The
outside-the-year cause SHALL list each crossing with its document number, the day the consumption
was dated, and its amount, because "how much crossed the boundary" is answered by the figure and
"which ones" is the question the figure provokes, and a reader who cannot see the second has to go
looking for it in a ledger.

Where such a list is capped, the screen SHALL state how many it did not show. A truncated list that
does not admit to being truncated reports a smaller problem than the one that exists, and the reader
has no way to tell the difference between ten crossings and a hundred.

An account whose unexplained remainder is non-zero SHALL be marked. A screen that reports a
reconciliation and a discrepancy in the same neutral typeface asks the reader to do the report's job.

The screen SHALL show the vouchers-on-budgeted-accounts figure, and SHALL show the expenses skipped
for want of a budget, so that the case the reconciliation is blind to is visible beside it rather
than on a screen somebody has to know to look for.

Amounts SHALL be formatted with the base currency's decimal places and SHALL never be carried as a
JS number.

#### Scenario: The unexplained remainder is visible without expanding a row

- **GIVEN** a reconciliation in which one account has an unexplained remainder
- **WHEN** the screen renders
- **THEN** that figure appears on the account's own row

#### Scenario: An unexplained difference is marked

- **GIVEN** one account whose unexplained remainder is zero and one whose is not
- **WHEN** the screen renders
- **THEN** only the second is marked

#### Scenario: The causes are readable

- **GIVEN** an account whose difference the server decomposed into named causes
- **WHEN** its row is expanded
- **THEN** each cause is listed with its amount

#### Scenario: The documents behind a crossing are named

- **GIVEN** an account whose consumption was dated outside the year of the appropriation it drew on
- **WHEN** its row is expanded
- **THEN** each crossing document is listed with its number, the date its consumption was dated, and
  its amount

#### Scenario: A capped list says how many it did not show

- **GIVEN** an account with more crossings than the screen lists
- **WHEN** its row is expanded
- **THEN** the number not shown is stated beside the list

#### Scenario: The blind spot is shown beside the reconciliation

- **GIVEN** a company with expenses skipped for want of a budget
- **WHEN** the screen renders
- **THEN** those documents are shown on it, with their totals

#### Scenario: A viewer without the reporting permission is kept out

- **WHEN** a user without the reporting permission opens the route
- **THEN** they are redirected away from it
