## ADDED Requirements

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
