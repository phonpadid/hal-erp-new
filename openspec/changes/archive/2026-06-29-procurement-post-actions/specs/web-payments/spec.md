## ADDED Requirements

### Requirement: Ready-to-Pay List

The web app SHALL show a `PAYMENT_VIEW` user the active company's ready-to-pay queue — settled
`CUT_BUDGET` documents with their vendor, base actual amount, and GL account(s) — each linking to the
source document. The list and its navigation SHALL be shown only to users holding `PAYMENT_VIEW`
(UX only; the server enforces and scopes by company).

#### Scenario: Lists settled payables

- **WHEN** a `PAYMENT_VIEW` user opens the ready-to-pay list
- **THEN** the active company's settled `CUT_BUDGET` documents are listed with vendor, base amount, and GL

#### Scenario: Empty queue

- **WHEN** nothing is ready to pay
- **THEN** the list shows an empty state rather than an error

#### Scenario: List hidden without permission

- **WHEN** a user without `PAYMENT_VIEW` is signed in
- **THEN** the Payments navigation entry and list are not shown
