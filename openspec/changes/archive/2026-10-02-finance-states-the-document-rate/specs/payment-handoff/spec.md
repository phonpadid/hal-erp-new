## ADDED Requirements

### Requirement: Finance States the Document's Rate

The rate stated on a document's transfer slip SHALL become the document's own rate: the system SHALL
write it to `document.exchange_rate` and recompute `base_total_amount` and every line's
`base_line_amount` from it.

This is the point of the field. The person attaching the slip is the person who converted the money,
and the figure the bank gave them is the figure the document is worth. Recording it only against the
payment leaves the document, the budget and the books each carrying a number nobody paid.

Restating the rate SHALL be one operation with the budget adjustment it forces (see `budget-control`)
and the log entry that attributes it: all three commit together or none do.

#### Scenario: The stated rate becomes the document's rate

- **GIVEN** a document in approval, locked at one rate, with an approval step still to come
- **WHEN** a `PAYMENT_MANAGE` user states a different rate on its transfer slip
- **THEN** the document's rate, base total and line base amounts are all recomputed at the stated rate

#### Scenario: The recorded payment agrees with the document

- **GIVEN** a document whose rate was restated to what finance actually paid
- **WHEN** its payment is recorded
- **THEN** the locked rate and the actual rate are the same figure and the FX difference is zero

### Requirement: A Rate Is Stated Only While The Document Can Still Be Refused

Restating the rate SHALL be refused unless the document is `IN_APPROVAL` **and** at least one
approval step has not yet been decided. It SHALL also be refused once a payment exists for the
document.

Somebody must still be able to say no to the figure. On a route that ends with accounting, that is
accounting: they approve the number finance actually paid, not a number that changed after they
approved it. A refusal SHALL name the reason — that the document is past its last approval, or
already paid — rather than failing generically.

Earlier approvals SHALL NOT be invalidated by a restatement. Approval routing compares its bands
against the budget base, so where a `BUDGET_RATE` is configured no approver's authority band moves
beneath them; where it is not, the re-reservation is subject to the same over-limit policy as the
original.

#### Scenario: The last approver still signs the final figure

- **GIVEN** a document waiting on its final approval step
- **WHEN** finance restates the rate
- **THEN** it is accepted, and the final approver acts on the restated figure

#### Scenario: A document past its last approval is refused

- **GIVEN** a `COMPLETED` document
- **WHEN** a rate is stated on it
- **THEN** the request is refused naming that no approval remains, and nothing is written

#### Scenario: A paid document is refused

- **GIVEN** a document whose payment is already recorded
- **WHEN** a rate is stated on it
- **THEN** the request is refused naming the recorded payment, and nothing is written

### Requirement: Every Restatement Is Attributed

The system SHALL write an `approval_log` row for each restatement recording who stated the rate, the
rate before, the rate after, and when.

The approvals already given remain readable against the figure they were given on. Somebody
reconciling the month has to be able to see that the number moved, who moved it, and by how much —
otherwise a document that changed value mid-approval is indistinguishable from one that never did.

#### Scenario: The change is attributable afterwards

- **WHEN** finance restates a document's rate from one figure to another
- **THEN** the approval log carries a row naming the user, both rates, and the time

### Requirement: The Rate Is Stated Without Re-Attaching Evidence

The system SHALL accept a stated rate for a document on its own, without a file. Attaching a slip
SHALL continue to carry the rate as it does today.

A rate that can only travel with an upload is a rate that gets typed and discarded — which is what
happened, silently, to a correction finance had already made. Correcting the figure and attaching a
second copy of a slip already on file are different acts and SHALL NOT be the same request.

#### Scenario: A correction needs no second copy of the slip

- **GIVEN** a document whose slip is already attached
- **WHEN** finance states a corrected rate without attaching anything
- **THEN** the rate is stored, the document is restated, and no second slip is written

#### Scenario: Attaching a slip still states the rate

- **WHEN** finance attaches a slip that carries a rate
- **THEN** the slip records that rate and the document is restated from it
