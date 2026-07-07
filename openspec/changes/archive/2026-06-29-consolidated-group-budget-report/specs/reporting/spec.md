## ADDED Requirements

### Requirement: Consolidated Group Budget-Balance Report

The system SHALL provide a consolidated budget-balance report for Group executives that aggregates
EVERY active company's budget balances and converts them into a caller-chosen presentation currency.
Access SHALL require the `REPORT_GROUP_VIEW` permission held at GROUP scope: the endpoint SHALL
require the permission code, and the service SHALL verify it is granted at GROUP scope before reading
across companies; a caller holding only company-scoped `REPORT_VIEW` (or `REPORT_GROUP_VIEW` at a
narrower scope) SHALL be refused. The cross-company read SHALL be read-only.

For each active company, the report SHALL derive budget balances from `budget_txn` using the same
derived-balance formula as the company-scoped report (never a stored value), in that company's base
currency, then convert the company's totals into the presentation currency using the GROUP exchange
rate as of the report date (the company-override→GROUP→inverse resolution with no company override),
defaulting the date to today. The conversion SHALL be presentation-only: it MUST NOT write any ledger
row, MUST NOT modify `budget.amount_total`, and MUST NOT alter any document's locked exchange rate
(invariant: locked FX). The response SHALL include, per company, the source base currency, the
resolved rate and its source, the native-currency total, and the converted total; plus a group total
in the presentation currency.

When no exchange rate resolves for a company's base→presentation pair as of the date, that company
SHALL be reported as unconvertible with its native total still shown, and SHALL be excluded from the
group total rather than failing the entire report. A company whose base currency equals the
presentation currency SHALL convert at rate 1.

#### Scenario: Group total in the chosen presentation currency

- **WHEN** a caller with `REPORT_GROUP_VIEW` at GROUP scope requests the consolidated report for a
  presentation currency
- **THEN** every active company's budget balances are shown converted into that currency at the GROUP
  rate as of the report date, with a group total in that currency

#### Scenario: Requires GROUP-scope permission

- **WHEN** a caller holding only company-scoped `REPORT_VIEW` (or `REPORT_GROUP_VIEW` not at GROUP
  scope) requests the consolidated report
- **THEN** the request is refused and no cross-company data is read

#### Scenario: Conversion is presentation-only

- **WHEN** the consolidated report converts each company's totals
- **THEN** no `budget_txn` row is written, no `budget.amount_total` is changed, and no document's
  locked exchange rate is recomputed

#### Scenario: A company without a resolvable rate is reported, not fatal

- **WHEN** no GROUP rate resolves for one company's base→presentation pair as of the date
- **THEN** that company is marked unconvertible with its native total shown and is excluded from the
  group total, while the other companies still convert and the report still returns

#### Scenario: Same-currency company converts at parity

- **WHEN** a company's base currency equals the presentation currency
- **THEN** its totals are included at rate 1 (no rate lookup needed)
