# Purchase Tax Specification

## Purpose
Purchase-side tax on documents: a per-company tax-code master and input VAT computed on
document lines, posted to the general ledger and reported by period. This is the VAT slice;
withholding tax (WHT) at payment is a deferred follow-up under the same capability (the
`tax_code.kind` enum already accepts `WHT`).

## Requirements

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


### Requirement: Withholding Tax at Payment

The system SHALL deduct withholding tax (WHT) at payment. A `WHT` `tax_code` MAY be selected when
recording a payment. When present, the system SHALL compute `wht_amount = round(net_base × wht_rate,
currency.decimal_places)` where `net_base = base_locked − base_tax_total` (the document's pre-VAT
net in base currency), pay the vendor the base actual amount net of `wht_amount`, and store
`wht_amount` + `wht_tax_code_id` on the `payment`. A tax code whose `kind` is not `WHT` SHALL be
rejected. WHT MUST NOT write any `budget_txn` (invariant 6).

#### Scenario: WHT is deducted from the cash paid

- **GIVEN** a settled disbursement with `base_locked` = `base_actual` = 100000, `base_tax_total` 0,
  paid with a 3% WHT code
- **WHEN** the payment is recorded
- **THEN** `payment.wht_amount` is 3000 and the cash paid to the vendor is 97000

#### Scenario: WHT base excludes VAT

- **GIVEN** a settled disbursement with net 100000 and VAT 7000 (`base_locked` = `base_actual` =
  107000, `base_tax_total` 7000), paid with a 3% WHT code
- **WHEN** the payment is recorded
- **THEN** `wht_amount` is 3000 (3% of the 100000 net, not the 107000 gross) and the cash paid is
  104000

#### Scenario: No WHT code means no withholding

- **WHEN** a disbursement is paid without a WHT `tax_code`
- **THEN** `payment.wht_amount` is 0 and the full base actual is paid

#### Scenario: A non-WHT tax code is rejected

- **WHEN** a payment is recorded with a `tax_code` whose `kind` is `VAT`
- **THEN** the record is rejected

### Requirement: Withholding Tax in the Tax Summary

The read-only, `TAX_VIEW`-gated tax summary SHALL report withheld WHT by period alongside the input
VAT, and it MUST NOT mutate any ledger.

#### Scenario: Summary reports withheld WHT by period

- **WHEN** a `TAX_VIEW` user requests the tax summary after WHT-bearing payments settle
- **THEN** the summary includes the withheld WHT totals per period for the active company only
