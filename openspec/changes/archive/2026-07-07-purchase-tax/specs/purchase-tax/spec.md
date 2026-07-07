## ADDED Requirements

### Requirement: Company-Scoped Tax-Code Master

The system SHALL maintain purchase tax codes in a `tax_code` table scoped by `company_id`. Each
tax code SHALL have a `code`, a `name`, a `kind` (`VAT` | `WHT`), a `rate` (decimal fraction), and
an `is_active` flag. `code` SHALL be unique per company. Tax rates are configuration, not code
(invariant 7); authorization uses a `TAX_VIEW` / `TAX_MANAGE` permission code, never role names
(invariant 6). (This slice uses `VAT` codes; `WHT` is accepted by the master for a deferred
follow-up.)

#### Scenario: Tax code is unique per company and typed

- **WHEN** a `VAT` tax code `VAT7` at rate 0.07 is created for a company
- **THEN** it is stored active, and a second `VAT7` for the same company is rejected as a duplicate

#### Scenario: Managing tax codes is permission-gated

- **WHEN** a request without `TAX_MANAGE` tries to create or update a tax code
- **THEN** it is rejected with 403 before the handler runs

### Requirement: VAT on Document Lines

A `document_line` MAY reference a `VAT` `tax_code`. On submit the system SHALL compute each line's
`tax_amount = round(net_line × rate, currency.decimal_places)` and stamp the document totals
`sub_total` (Σ net line), `tax_total` (Σ line `tax_amount`), and `grand_total` (`sub_total +
tax_total`). A line with no tax code SHALL have `tax_amount` 0. Input VAT SHALL NOT change the
budget basis — the budget reserve/actual stays on the pre-tax `budget_base_line_amount`
(invariants 3, 4).

#### Scenario: VAT is computed and summed to the document total

- **GIVEN** a document with two lines of net 1000 and 2000, each with a 7% VAT code
- **WHEN** it is submitted
- **THEN** the lines carry `tax_amount` 70 and 140, and the document has `sub_total` 3000,
  `tax_total` 210, `grand_total` 3210

#### Scenario: VAT does not change the reserved budget

- **GIVEN** a line of net 1000 with a 7% VAT code
- **WHEN** the document is submitted
- **THEN** the budget reserved for that line is 1000 (the pre-tax base), not 1070

#### Scenario: A line without a tax code is untaxed

- **WHEN** a line has no `tax_code`
- **THEN** its `tax_amount` is 0 and it does not add to `tax_total`

### Requirement: Read-Only Input-VAT Summary

The system SHALL expose a read-only, company-scoped input-VAT summary gated by `TAX_VIEW` — VAT by
period — and it MUST NOT mutate any ledger.

#### Scenario: VAT summary is permission-gated and read-only

- **WHEN** a `TAX_VIEW` user in company A requests the VAT summary
- **THEN** only company A's VAT figures are returned and nothing is written

#### Scenario: Summary without permission is rejected

- **WHEN** a request without `TAX_VIEW` queries the VAT summary
- **THEN** it is rejected with 403
