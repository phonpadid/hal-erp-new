## MODIFIED Requirements

### Requirement: Budget Adjustment Affordance

The budget detail page SHALL offer an "Adjust" action, shown only to users holding `BUDGET_MANAGE`
(UX only; the server still enforces). Activating it SHALL open a dialog to choose the direction
(increase or decrease), enter an amount, and enter a reason. When the active company has more than
one configured document type for the chosen direction, the dialog SHALL present a required
document-type selector and SHALL send the chosen type with the create request; when the company
has zero or one type for that direction, the dialog SHALL NOT show a selector and SHALL behave as
before. On confirm, the client SHALL create an adjustment document for that budget and navigate the
user to the new document so it can be submitted for approval — the client SHALL NOT attempt to
change the balance directly. The amount SHALL be handled as a string/Decimal (never a JS number),
all labels SHALL come from i18n with en/la parity, and the dialog SHALL use PrimeUI theme tokens so
it renders correctly in light and dark mode.

#### Scenario: Adjust action hidden without BUDGET_MANAGE

- **WHEN** a user holding only `BUDGET_VIEW` opens a budget detail page
- **THEN** the Adjust action is not shown

#### Scenario: Creating an adjustment routes to its approvable document

- **GIVEN** a user with `BUDGET_MANAGE` on a budget detail page
- **WHEN** they choose increase, enter an amount and a reason, and confirm
- **THEN** an adjustment document is created and the user is taken to that document to submit it for approval
- **AND** the budget's displayed balance does not change until the document is fully approved

#### Scenario: Type selector appears only when the direction has multiple types

- **GIVEN** the active company has two increase types and one decrease type
- **WHEN** the user chooses the increase direction
- **THEN** the dialog shows a required document-type selector
- **WHEN** the user chooses the decrease direction
- **THEN** the dialog shows no selector and uses the single decrease type

#### Scenario: Invalid input is blocked before submit

- **WHEN** the amount is empty or not a valid positive number, the reason is empty, or a type
  selector is shown but no type is chosen
- **THEN** the dialog shows a field error and does not create a document

### Requirement: Budget Transfer Affordance

The budget screens SHALL offer a "Transfer" action shown only to users holding `BUDGET_MANAGE`
(UX only; the server still enforces). Activating it SHALL open a dialog to pick a source budget
and a destination budget in the same company and same fiscal year, display each budget's derived
available balance for guidance, and enter an amount and a reason. When the active company has more
than one configured transfer document type, the dialog SHALL present a required document-type
selector and SHALL send the chosen type with the create request; when the company has zero or one
transfer type, the dialog SHALL NOT show a selector and SHALL behave as before. On confirm, the
client SHALL create an approvable transfer document for that pair and navigate the user to the new
document so it can be submitted for approval — the client SHALL NOT move money or write the ledger
directly. The amount SHALL be handled as a string/Decimal (never a JS number), all labels SHALL
come from i18n with en/la parity, and the dialog SHALL use PrimeUI theme tokens.

#### Scenario: Transfer action hidden without BUDGET_MANAGE

- **WHEN** a user holding only `BUDGET_VIEW` views the budgets
- **THEN** the Transfer action is not shown

#### Scenario: Creating a transfer routes to its approvable document

- **GIVEN** a `BUDGET_MANAGE` user with two budgets in the same company and fiscal year
- **WHEN** they pick source and destination, enter an amount and a reason, and confirm
- **THEN** a transfer document is created and the user is taken to that document to submit it for approval
- **AND** neither budget's displayed balance changes until the document is fully approved

#### Scenario: Type selector appears only with multiple transfer types

- **GIVEN** the active company has two active transfer types
- **WHEN** the Transfer dialog is opened
- **THEN** it shows a required document-type selector and sends the chosen type on confirm

#### Scenario: Invalid transfer input is blocked before submit

- **WHEN** the source and destination are the same, the amount is empty or not a positive number,
  the reason is empty, or a type selector is shown but no type is chosen
- **THEN** the dialog shows a field error and does not create a document
