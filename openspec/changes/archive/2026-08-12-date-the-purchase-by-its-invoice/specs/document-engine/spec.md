# document-engine

## ADDED Requirements

### Requirement: A Document Claiming Input VAT Names Its Tax Invoice

A document SHALL carry the supplier's invoice number and invoice date, and submit SHALL reject a
document that carries VAT, whose type recognises the expense at approval, and which does not carry
both. Input VAT is claimable against a tax invoice; a claim that cannot name one is not supportable.

The requirement SHALL apply only to the documents that claim the VAT — those whose type sets
`accrues_on_approval`, which are exactly the documents whose accrual posts input VAT and is dated by
the invoice. A requisition or an order MAY carry a tax code to estimate a purchase's cost without
naming an invoice, because no supplier invoice exists when a commitment is raised.

Both fields SHALL be optional on the document itself, because most document types are not purchases
— a leave request or a promotion has no supplier invoice, and requiring one would be a field to
invent a value for.

#### Scenario: A VAT-bearing document that accrues must name its invoice

- **GIVEN** a document whose lines carry a tax code, of a type that accrues on approval
- **WHEN** it is submitted without an invoice number or without an invoice date
- **THEN** the submit is rejected and the document stays `DRAFT`

#### Scenario: A commitment may estimate tax without an invoice

- **GIVEN** a requisition carrying a tax code, of a type that does not accrue on approval
- **WHEN** it is submitted with neither field
- **THEN** it is accepted, because no supplier invoice exists when a commitment is raised

#### Scenario: A document with no VAT needs no invoice

- **GIVEN** a document whose lines carry no tax code
- **WHEN** it is submitted with neither field
- **THEN** it is accepted

#### Scenario: The invoice details are stamped on the document

- **WHEN** a VAT-bearing document is submitted with an invoice number and date
- **THEN** both are stored on the document and readable afterwards

### Requirement: Accrual On Approval May Be Combined With Requiring A Payee

A document type SHALL be permitted to set `accrues_on_approval` and `requires_payee` together, and
the system SHALL NOT reject that combination.

The two once conflicted: both paths debited the same expense accounts, so a type carrying both
recognised its expense twice. Since the payable was introduced, the payment path clears the payable
the accrual raised instead of debiting expense again, and the combination is the correct
configuration for a disbursement — the reference configuration ships it.

#### Scenario: A disbursement type carries both flags

- **WHEN** a document type is configured with `accrues_on_approval` and `requires_payee` both true
- **THEN** it is accepted

#### Scenario: The expense is recognised once

- **GIVEN** such a type
- **WHEN** a document of it is approved and later paid
- **THEN** the expense is recognised at the approval and the payment clears the payable rather than
  debiting expense a second time
