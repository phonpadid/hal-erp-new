# web-payments Specification

## Purpose
TBD - created by archiving change procurement-post-actions. Update Purpose after archive.
## Requirements
### Requirement: Ready-to-Pay List

The web app SHALL show a `PAYMENT_VIEW` user the active company's ready-to-pay queue — settled
`CUT_BUDGET` documents with their vendor, base actual amount, and GL account(s) — each linking to the
source document. A `PAYMENT_MANAGE` user SHALL be able to record a payment from the list by entering
the actual exchange rate; on success the resulting FX gain/loss is shown and the disbursement leaves
the queue. The list and its navigation SHALL be shown only to users holding `PAYMENT_VIEW`, and the
record-payment affordance only to `PAYMENT_MANAGE` (UX only; the server enforces and scopes by company).

#### Scenario: Lists settled payables

- **WHEN** a `PAYMENT_VIEW` user opens the ready-to-pay list
- **THEN** the active company's settled `CUT_BUDGET` documents are listed with vendor, base amount, and GL

#### Scenario: Record a payment and see the FX result

- **WHEN** a `PAYMENT_MANAGE` user records a payment with an actual rate
- **THEN** the FX gain/loss is shown and the disbursement is removed from the queue

#### Scenario: Empty queue

- **WHEN** nothing is ready to pay
- **THEN** the list shows an empty state rather than an error

#### Scenario: Record affordance hidden without permission

- **WHEN** a user without `PAYMENT_MANAGE` views the list
- **THEN** the record-payment action is not shown

