## ADDED Requirements

### Requirement: A Document Type Declares Whether Its Expense Is Recognised At Approval

A `document_type` SHALL carry a flag declaring that its expense is recognised when the document is fully approved rather than when a payment settles. The flag SHALL default to false, so every existing type keeps its current behaviour. The flag SHALL NOT be inferred from `post_action` or from `requires_payee`: a type opts in explicitly, because both of those answer different questions and a type that happens to match them has not asked for an accrual.

A type SHALL NOT carry the flag together with `requires_payee = true`. Both recognitions debit the same expense accounts — the accrual from the document's budget cuts, and the settlement posting from the same rows — so a type doing both would recognise its expense twice. The combination SHALL be rejected when the type is configured.

#### Scenario: A claim type opts in

- **WHEN** a document type is configured with the flag set and `requires_payee` false
- **THEN** the configuration is accepted, and documents of that type recognise their expense at approval

#### Scenario: An ordinary type is unchanged

- **GIVEN** a document type created without mentioning the flag
- **THEN** the flag is false and the type behaves exactly as it did before the flag existed

#### Scenario: Accrual and payee together are rejected

- **WHEN** a document type is configured with the flag set and `requires_payee` true
- **THEN** the configuration is rejected, because the expense would be recognised twice
