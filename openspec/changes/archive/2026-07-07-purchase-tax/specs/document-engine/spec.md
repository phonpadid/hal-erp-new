## MODIFIED Requirements

### Requirement: Document Submit Lifecycle

On submit the system SHALL, in a single transaction: validate that every required **and visible**
`form_field` has a value — a field whose `condition_json` evaluates to hidden is neither required
nor persisted; resolve and **lock** the FX rate at the submit date, stamping `exchange_rate`,
`base_total_amount`, and each line's `base_line_amount`; compute per-line input VAT from each
line's `tax_code` and stamp the line `tax_amount` and the document totals `sub_total` / `tax_total`
/ `grand_total` (a line with no tax code contributes `tax_amount` 0), with `base_total_amount`
reflecting the tax-inclusive grand total while the budget basis `budget_base_line_amount` stays
pre-tax (invariants 3, 4); reject the submit if the document's date falls in a CLOSED fiscal
period; reject any vendor or item not enabled for the active company; and then transition the
document from `DRAFT` to `SUBMITTED`. If any step fails, no holds are created and the document
stays `DRAFT`.

#### Scenario: Submit locks the FX rate and base amounts

- **WHEN** a foreign-currency document is submitted
- **THEN** `exchange_rate` and `base_total_amount` are stamped from the rate resolved at
  the submit date, and a later rate change does not alter them

#### Scenario: Submit computes VAT and document totals

- **GIVEN** a document with lines of net 1000 and 2000, each with a 7% VAT code
- **WHEN** it is submitted
- **THEN** `sub_total` is 3000, `tax_total` is 210, and `grand_total` is 3210, while the reserved
  budget uses the pre-tax line base

#### Scenario: Missing required field blocks submit

- **GIVEN** a required `form_field` with no `doc_field_value`
- **WHEN** the document is submitted
- **THEN** submission is rejected and the document remains `DRAFT`

#### Scenario: Hidden required field does not block submit

- **GIVEN** a required `form_field` whose `condition_json` evaluates to hidden for the document's values
- **WHEN** the document is submitted without a value for that field
- **THEN** submission is not blocked by that field and any stored value for it is ignored

#### Scenario: Submit into a closed period is rejected

- **WHEN** a budget-consuming document dated in a CLOSED fiscal year is submitted
- **THEN** submission is rejected with a closed-period error
