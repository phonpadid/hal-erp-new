## MODIFIED Requirements

### Requirement: Attach and View a Payment's Slips

The web app SHALL let a `PAYMENT_MANAGE` user attach one or more slips at the moment a payment is recorded, and SHALL show the slips of a disbursement on that document, each downloadable by a `PAYMENT_VIEW` user. Evidence SHALL remain reachable after payment: the ready-to-pay queue drops a disbursement as soon as it is paid, so the document it was raised from is where its slips are read. The upload affordance SHALL be shown only to a user holding `PAYMENT_MANAGE`, and the delete affordance only to one holding `PAYMENT_SLIP_DELETE`, mirroring the server's rules — the client guard is UX only. A disbursement with no slips SHALL say so rather than render an empty area.

The evidence panel SHALL be shown for a document carrying at least one slip even when no payment has been recorded against it, because a slip attached during approval is evidence of the same standing as one attached afterwards, and hiding it would state that no evidence exists while it sits in storage. The panel SHALL additionally be shown, empty and with its upload control, for a document at a step that requires a slip, so the requirement can be satisfied where the evidence is read. For a document with no payment, no slip, and no such requirement, no evidence panel SHALL be shown, since there is nothing for a slip to be evidence of.

The documents list SHALL report a document's evidence state as UPLOADED when the document carries at least one slip and PENDING otherwise. The state SHALL NOT require a recorded payment: a document evidenced during approval carries its slip already, and reporting it as PENDING would state the opposite of what is stored.

#### Scenario: Attaching the bank's slip when recording a payment

- **GIVEN** a disbursement the user has just recorded a payment against
- **WHEN** the user uploads a slip without leaving the confirmation
- **THEN** the slip is attached to that document and listed there

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

#### Scenario: Evidence attached before payment is shown

- **GIVEN** a document carrying a slip uploaded during approval, with no payment recorded
- **WHEN** a `PAYMENT_VIEW` user opens that document
- **THEN** the evidence panel lists the slip

#### Scenario: A document with nothing to evidence shows no panel

- **WHEN** a user opens a document with no payment, no slip, and no step requiring one
- **THEN** no evidence panel is shown

#### Scenario: The documents list reports evidence attached during approval

- **GIVEN** a document carrying a slip and no recorded payment
- **WHEN** a user views it in the documents list
- **THEN** its evidence state reads UPLOADED
