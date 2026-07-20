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

### Requirement: Attach and View a Payment's Slips

The web app SHALL let a `PAYMENT_MANAGE` user attach one or more slips at the moment a payment is recorded, and SHALL show the slips of a paid disbursement on that document, each downloadable by a `PAYMENT_VIEW` user. Evidence SHALL remain reachable after payment: the ready-to-pay queue drops a disbursement as soon as it is paid, so the document it was raised from is where its slips are read. The upload affordance SHALL be shown only to a user holding `PAYMENT_MANAGE`, and the delete affordance only to one holding `PAYMENT_SLIP_DELETE`, mirroring the server's rules — the client guard is UX only. A paid disbursement with no slips SHALL say so rather than render an empty area.

#### Scenario: Attaching the bank's slip when recording a payment

- **GIVEN** a disbursement the user has just recorded a payment against
- **WHEN** the user uploads a slip without leaving the confirmation
- **THEN** the slip is attached to that payment and listed there

#### Scenario: The evidence outlives the queue entry

- **GIVEN** a disbursement that has been paid and has therefore left the ready-to-pay queue
- **WHEN** a `PAYMENT_VIEW` user opens that document
- **THEN** its slips are listed and can be downloaded

#### Scenario: Evidence controls follow the permission codes

- **GIVEN** a user holding `PAYMENT_VIEW` but neither `PAYMENT_MANAGE` nor `PAYMENT_SLIP_DELETE`
- **WHEN** the user opens a paid disbursement carrying a slip
- **THEN** the slip is listed with no upload control and no delete control

#### Scenario: A paid disbursement without evidence

- **WHEN** a user opens a paid disbursement that has no slips
- **THEN** the app states that no slip is attached

#### Scenario: A document that was never paid shows no evidence panel

- **WHEN** a user opens a document with no payment recorded against it
- **THEN** no evidence panel is shown, since there is nothing for a slip to be evidence of

