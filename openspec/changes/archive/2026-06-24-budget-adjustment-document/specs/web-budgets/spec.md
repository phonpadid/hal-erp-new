## ADDED Requirements

### Requirement: Budget Adjustment Affordance

The budget detail page SHALL offer an "Adjust" action, shown only to users holding `BUDGET_MANAGE`
(UX only; the server still enforces). Activating it SHALL open a dialog to choose the direction
(increase or decrease), enter an amount, and enter a reason. On confirm, the client SHALL create an
adjustment document for that budget and navigate the user to the new document so it can be submitted
for approval — the client SHALL NOT attempt to change the balance directly. The amount SHALL be
handled as a string/Decimal (never a JS number), all labels SHALL come from i18n with en/la parity,
and the dialog SHALL use PrimeUI theme tokens so it renders correctly in light and dark mode.

#### Scenario: Adjust action hidden without BUDGET_MANAGE

- **WHEN** a user holding only `BUDGET_VIEW` opens a budget detail page
- **THEN** the Adjust action is not shown

#### Scenario: Creating an adjustment routes to its approvable document

- **GIVEN** a user with `BUDGET_MANAGE` on a budget detail page
- **WHEN** they choose increase, enter an amount and a reason, and confirm
- **THEN** an adjustment document is created and the user is taken to that document to submit it for approval
- **AND** the budget's displayed balance does not change until the document is fully approved

#### Scenario: Invalid input is blocked before submit

- **WHEN** the amount is empty or not a valid positive number, or the reason is empty
- **THEN** the dialog shows a field error and does not create a document
