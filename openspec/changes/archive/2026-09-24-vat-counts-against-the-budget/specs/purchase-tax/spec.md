## MODIFIED Requirements

### Requirement: VAT on Document Lines

A `document_line` MAY reference a `VAT` `tax_code`. On submit the system SHALL compute each line's
`tax_amount = round(net_line × rate, currency.decimal_places)` and stamp the document totals
`sub_total` (Σ net line), `tax_total` (Σ line `tax_amount`), and `grand_total` (`sub_total +
tax_total`). A line with no tax code SHALL have `tax_amount` 0.

Input VAT SHALL be part of the budget basis: `budget_base_line_amount` SHALL be converted from
`line_amount + tax_amount`, and `budget_base_total_amount` from `grand_total`. The company bears the
tax on a purchase, so the budget the purchase is charged to bears it too — a budget charged the
pre-tax figure reads as having room that the next payment has already spent.

The line's own `tax_code` is what decides this, and no further setting SHALL be introduced. A line
that names a VAT code charges the budget for the tax it carries; a line that names none charges the
same amount either way, because its `tax_amount` is zero.

The rate itself is never assumed. It comes from the line's `tax_code`, so a company on 10% and one on
7% are the same code and different configuration — the scenarios below use 10%, the rate this
deployment runs on.

#### Scenario: VAT is computed and summed to the document total

- **GIVEN** a document with two lines of net 1000 and 2000, each with a 10% VAT code
- **WHEN** it is submitted
- **THEN** the lines carry `tax_amount` 100 and 200, and the document has `sub_total` 3000,
  `tax_total` 300, `grand_total` 3300

#### Scenario: The budget is charged what the purchase costs

- **GIVEN** a line of net 1000 with a 10% VAT code
- **WHEN** the document is submitted
- **THEN** the budget reserved for that line is 1100 — the tax-inclusive base, which is what leaves
  the company

#### Scenario: An untaxed line is charged exactly as before

- **WHEN** a line has no `tax_code`
- **THEN** its `tax_amount` is 0, it does not add to `tax_total`, and the budget reserved for it is
  its net amount — unchanged by this rule

#### Scenario: A mixed document charges each line for its own tax

- **GIVEN** one line of net 1000 with a 10% VAT code and one of net 500 with no tax code
- **WHEN** the document is submitted
- **THEN** the budget is reserved 1100 for the first line and 500 for the second
