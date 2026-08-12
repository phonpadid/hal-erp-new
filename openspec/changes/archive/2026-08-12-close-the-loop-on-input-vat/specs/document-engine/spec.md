# document-engine

## ADDED Requirements

### Requirement: A Document Claiming Input VAT Recognises Its Expense At Approval

Submit SHALL reject a document whose `tax_total` is greater than zero, whose type requires a payee,
and whose type does not set `accrues_on_approval`.

Input VAT is claimable at the tax invoice, and a type that recognises its expense at payment debits
`VAT_INPUT` on the payment date instead. Allowing both leaves two documents with the same supplier
invoice date falling in different returns depending on a `document_type` flag set for an unrelated
reason, and a return computed from a ledger whose tax points disagree cannot be defended.

The rule SHALL apply only to types that are PAID — those requiring a payee. A requisition or an
order MAY carry a tax code to estimate what a purchase will cost without being the document that
claims the VAT, and no supplier invoice exists when a commitment is raised.

The refusal SHALL name the reason, so an administrator knows the fix is the type's configuration
rather than the document.

#### Scenario: A paid document claiming VAT on a cash-basis type is refused

- **GIVEN** a document carrying VAT whose type requires a payee and does not accrue on approval
- **WHEN** it is submitted
- **THEN** it is rejected naming the type's configuration, and the document stays `DRAFT`

#### Scenario: A commitment may still estimate its tax

- **GIVEN** a requisition carrying a tax code, of a type that requires no payee
- **WHEN** it is submitted
- **THEN** it is accepted — it estimates a cost and is not the document that claims the VAT

#### Scenario: A VAT-bearing document on an accruing type is accepted

- **GIVEN** a paid document on a type that accrues on approval
- **WHEN** it is submitted with its supplier invoice
- **THEN** it is accepted

#### Scenario: A document with no VAT is unaffected

- **GIVEN** a document carrying no tax code, of a type that does not accrue
- **WHEN** it is submitted
- **THEN** it is accepted
