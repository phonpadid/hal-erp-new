# purchase-tax

## MODIFIED Requirements

### Requirement: Read-Only Input-VAT Summary

The system SHALL expose a read-only, company-scoped input-VAT summary gated by `TAX_VIEW` — VAT by
period — and it MUST NOT mutate any ledger.

The figures SHALL be derived from the general ledger: input VAT for a period is the net movement on
the account mapped to the `VAT_INPUT` role, taken as `Σ debit − Σ credit` because input VAT is an
asset and is debited — so the summary cannot disagree with the books it is filed against. A period
SHALL be the calendar month of
`journal_entry.entry_date`, which is already resolved in the company's timezone; the summary SHALL
NOT derive a period from a UTC timestamp.

Company scope SHALL be applied through the active-company seam. A request with no active company
SHALL NOT return another company's figures.

When the `VAT_INPUT` role is not mapped for the company, the summary SHALL report no input VAT
rather than failing.

#### Scenario: VAT summary is permission-gated and read-only

- **WHEN** a `TAX_VIEW` user in company A requests the VAT summary
- **THEN** only company A's VAT figures are returned and nothing is written

#### Scenario: Summary without permission is rejected

- **WHEN** a request without `TAX_VIEW` queries the VAT summary
- **THEN** it is rejected with 403

#### Scenario: The period follows the company's day, not UTC

- **GIVEN** a company whose timezone is ahead of UTC
- **AND** an entry whose company-day falls on the first of a month while its UTC instant falls on
  the last of the previous one
- **WHEN** the summary is requested
- **THEN** the figure is reported in the month of the company-day

#### Scenario: The summary agrees with the ledger

- **GIVEN** input VAT recognised on an entry dated in July
- **WHEN** the summary is requested
- **THEN** July's input VAT equals the net movement on the `VAT_INPUT` account for July

#### Scenario: A reversal reduces the period it is dated in

- **GIVEN** an entry carrying input VAT, later reversed
- **WHEN** the summary is requested
- **THEN** the reversal reduces the input VAT of the period the reversing entry is dated in

#### Scenario: An unmapped VAT role reports zero, not an error

- **GIVEN** a company with no account mapped to `VAT_INPUT`
- **WHEN** the summary is requested
- **THEN** it returns without error and reports no input VAT

### Requirement: Withholding Tax in the Tax Summary

The read-only, `TAX_VIEW`-gated tax summary SHALL report withheld WHT by period alongside the input
VAT, and it MUST NOT mutate any ledger.

The WHT figure SHALL be derived from the general ledger on the same terms as the input VAT: the net
movement on the account mapped to the `WHT_PAYABLE` role, by the calendar month of the entry date.
It SHALL be taken as `Σ credit − Σ debit`, because withheld tax is a liability and is credited; a
month in which tax was withheld SHALL report a positive figure. When that role is not mapped, the
summary SHALL report no WHT rather than failing.

#### Scenario: Summary reports withheld WHT by period

- **WHEN** a `TAX_VIEW` user requests the tax summary after WHT-bearing payments settle
- **THEN** the summary includes the withheld WHT totals per period for the active company only

#### Scenario: A month of withholding reports a positive figure

- **GIVEN** payments in a month that withheld tax
- **WHEN** the summary is requested
- **THEN** that month's WHT is positive, not the negative its credit balance would give

#### Scenario: WHT is reported in the month the ledger recorded it

- **GIVEN** a payment withholding tax, posted with an entry date in August
- **WHEN** the summary is requested
- **THEN** the withheld amount appears in August, regardless of the UTC instant of the payment

#### Scenario: An unmapped WHT role reports zero, not an error

- **GIVEN** a company with no account mapped to `WHT_PAYABLE`
- **WHEN** the summary is requested
- **THEN** it returns without error and reports no WHT
