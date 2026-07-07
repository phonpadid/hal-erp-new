## ADDED Requirements

### Requirement: Budget Create and Edit

The web app SHALL let a user holding `BUDGET_MANAGE` create a budget by dimension and edit an
existing budget's editable attributes (UX only; the server remains authoritative and
company-scoped). Creation SHALL capture `fiscal_year`, `department`, `gl_account`,
`budget_name`, `amount_total`, and the control policy (`HARD_STOP` or `SOFT_WARNING`), and on
save SHALL call the create endpoint. Editing SHALL allow changing `budget_name`,
`control_policy`, and `status` only; the form SHALL NOT offer `amount_total` for edit, because
usage is derived and `budget.amount_total` is never overwritten (invariant: derived balances).
`amount_total` SHALL be handled as a string/Decimal (never a JS number), all labels SHALL come
from i18n with en/la parity, and the form SHALL use PrimeUI theme tokens so it renders in light
and dark mode.

#### Scenario: Create form hidden without BUDGET_MANAGE

- **WHEN** a user holding only `BUDGET_VIEW` opens the budgets list
- **THEN** the "New budget" action and the create route are not available to them

#### Scenario: Creating a budget by dimension

- **GIVEN** a user with `BUDGET_MANAGE`
- **WHEN** they choose a fiscal year, department, and GL account, enter an amount and a policy, and save
- **THEN** the budget is created via the create endpoint and the user is taken to its detail

#### Scenario: Edit does not expose amount_total

- **WHEN** a `BUDGET_MANAGE` user edits an existing budget
- **THEN** they can change name, policy, and status, but `amount_total` is not editable
- **AND** the page indicates that changing the budget figure is done through Adjust

#### Scenario: Invalid input is blocked before save

- **WHEN** a required dimension is missing, or `amount_total` is empty or not a positive number
- **THEN** the form shows a field error and does not call the server

### Requirement: Budget Transfer Affordance

The budget screens SHALL offer a "Transfer" action shown only to users holding `BUDGET_MANAGE`
(UX only; the server still enforces). Activating it SHALL open a dialog to pick a source budget
and a destination budget in the same company and same fiscal year, display each budget's derived
available balance for guidance, and enter an amount and a reason. On confirm, the client SHALL
create an approvable transfer document for that pair and navigate the user to the new document so
it can be submitted for approval — the client SHALL NOT move money or write the ledger directly.
The amount SHALL be handled as a string/Decimal (never a JS number), all labels SHALL come from
i18n with en/la parity, and the dialog SHALL use PrimeUI theme tokens.

#### Scenario: Transfer action hidden without BUDGET_MANAGE

- **WHEN** a user holding only `BUDGET_VIEW` views the budgets
- **THEN** the Transfer action is not shown

#### Scenario: Creating a transfer routes to its approvable document

- **GIVEN** a `BUDGET_MANAGE` user with two budgets in the same company and fiscal year
- **WHEN** they pick source and destination, enter an amount and a reason, and confirm
- **THEN** a transfer document is created and the user is taken to that document to submit it for approval
- **AND** neither budget's displayed balance changes until the document is fully approved

#### Scenario: Invalid transfer input is blocked before submit

- **WHEN** the source and destination are the same, or the amount is empty or not a positive number, or the reason is empty
- **THEN** the dialog shows a field error and does not create a document

## MODIFIED Requirements

### Requirement: Budget List

The web app SHALL show a `BUDGET_VIEW` user the active company's budgets (name, GL account,
fiscal year, department, total, status) with the derived available balance per budget. Each
row links to the budget detail. The list SHALL NOT show budgets of other companies. All money
columns SHALL be formatted to the company base currency's `decimal_places` (never a hardcoded
number of decimals and never a JS number).

#### Scenario: Lists the company's budgets with available balance

- **WHEN** a `BUDGET_VIEW` user opens the budgets list
- **THEN** the active company's budgets are shown, each with its derived available balance

#### Scenario: Amounts honor the currency decimal places

- **GIVEN** the company base currency has 0 decimal places
- **WHEN** the budgets list is shown
- **THEN** each amount is formatted with 0 decimal places, not a hardcoded 2

### Requirement: Budget Balance Breakdown

The web app SHALL show, for a budget, the derived balance broken into its components — total,
adjustments, transfers in/out, reserved, actual, released, and the resulting available — each
formatted to the company base currency's `decimal_places`. The breakdown SHALL be the derived
figures, never a stored usage value on the budget, and amounts SHALL never be carried as a JS
number.

#### Scenario: Breakdown explains the available balance

- **WHEN** the user opens a budget's detail
- **THEN** the components are shown and reconcile to the available balance

#### Scenario: Breakdown amounts honor the currency decimal places

- **GIVEN** the company base currency has 3 decimal places
- **WHEN** the breakdown is shown
- **THEN** every component is formatted with 3 decimal places

### Requirement: Budget Ledger View

The web app SHALL show a budget's append-only ledger entries (transaction type, amount, source
document, remark, timestamp), most recent first, as a read-only history. Entries linked to a
source document SHALL link through to it. Amounts SHALL be formatted to the company base
currency's `decimal_places` and never carried as a JS number.

#### Scenario: Ledger shows the transactions behind the balance

- **WHEN** the user views a budget that has had a reservation settled
- **THEN** the RESERVE / ACTUAL / RELEASE entries are listed with their amounts

#### Scenario: Ledger amounts honor the currency decimal places

- **WHEN** the ledger is shown for a budget whose base currency has 0 decimal places
- **THEN** each entry amount is formatted with 0 decimal places
