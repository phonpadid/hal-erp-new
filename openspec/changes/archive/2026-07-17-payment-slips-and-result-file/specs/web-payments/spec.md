## ADDED Requirements

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
