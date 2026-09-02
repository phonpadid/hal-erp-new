## MODIFIED Requirements

### Requirement: A Document Type Declares Whether Its Expense Is Recognised At Approval

A `document_type` SHALL carry a flag declaring that its expense is recognised when the document is fully approved rather than when a payment settles. The flag SHALL default to false, so every existing type keeps its current behaviour. The flag SHALL NOT be inferred from `post_action` or from `requires_payee`: a type opts in explicitly, because both of those answer different questions and a type that happens to match them has not asked for an accrual.

A type MAY carry the flag together with `requires_payee = true`. The combination was previously rejected because both recognitions debited the same expense accounts — the accrual from the document's budget cuts, and the settlement posting from the same rows — so a type doing both would recognise its expense twice. That premise no longer holds: the settlement posting clears the payable an accrual raised instead of debiting expense again (see `gl-journal`'s `Posting on Payment Settlement`), so a purchase type that accrues recognises its expense exactly once, at approval, and its payment moves only cash and the payable.

#### Scenario: A claim type opts in

- **WHEN** a document type is configured with the flag set and `requires_payee` false
- **THEN** the configuration is accepted, and documents of that type recognise their expense at approval

#### Scenario: A purchase type opts in

- **WHEN** a document type is configured with the flag set and `requires_payee` true
- **THEN** the configuration is accepted, and documents of that type recognise their expense at approval and clear the payable when the payment settles

#### Scenario: An ordinary type is unchanged

- **GIVEN** a document type created without mentioning the flag
- **THEN** the flag is false and the type behaves exactly as it did before the flag existed
