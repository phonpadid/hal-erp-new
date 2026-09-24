## MODIFIED Requirements

### Requirement: Budget Controlled in Base Currency

The system SHALL convert document amounts to the company base currency for budget checks,
reservation, and approval-threshold comparison using the `BUDGET_RATE` rate type (falling back to the
daily rate when no `BUDGET_RATE` exists for the pair), and SHALL stamp this **budget base** on the
document and its lines (`budget_exchange_rate`, `budget_base_total_amount`,
`document_line.budget_base_line_amount`) at submit. Budget reservation and its conversion to actual
SHALL both use the same persisted budget base so the reserve→actual ledger stays balanced. The
document SHALL also continue to record the **daily** rate (`exchange_rate`, `base_total_amount`,
`base_line_amount`) for display and the payment FX gain/loss; the daily rate is unchanged.

Both bases SHALL be tax-INCLUSIVE: the budget base is converted from `grand_total` (and per line from
`line_amount + tax_amount`) at the budget rate, the daily base from `grand_total` at the daily rate.
They differ by the RATE and by nothing else, so a difference between them is always an FX difference
and never a tax one — which is what makes the FX gain/loss at payment mean what it says.

#### Scenario: Budget conversion uses the budget rate, display uses the daily rate

- **GIVEN** a foreign-currency document and a configured `BUDGET_RATE` for the pair
- **WHEN** it is submitted
- **THEN** the budget base is converted at the `BUDGET_RATE` and the displayed base at the daily rate

#### Scenario: The two bases differ only by the rate

- **GIVEN** a taxed document
- **WHEN** its two bases are compared
- **THEN** both are converted from the same tax-inclusive amount, so their ratio is the ratio of the
  two rates
