## MODIFIED Requirements

### Requirement: Exchange Rate Management

The web app SHALL let a `CURRENCY_VIEW` user list exchange rates (filterable by from/to currency)
and a `CURRENCY_MANAGE` user add a rate (from → to, rate, effective date, rate type, source, and
scope). The add form SHALL capture the rate `source` (e.g. BOT / bank / manual) and a scope —
group-wide (no company) or an override for the active company — sending the corresponding `source`
and `companyId`. Rates are append-only: a correction or a new effective date is recorded as a new
row, never an edit.

#### Scenario: Add an exchange rate

- **WHEN** the user adds a rate for a from→to pair on a date
- **THEN** it appears in the rate list

#### Scenario: Filter rates by currency pair

- **WHEN** the user filters by a from and to currency
- **THEN** only matching rates are listed

#### Scenario: Add a company-override rate with a source

- **WHEN** the user adds a rate with scope "this company" and a source
- **THEN** the rate is created for the active company with that source and shows as a company-scoped
  row in the list

#### Scenario: Add a group-wide rate

- **WHEN** the user adds a rate with scope "group"
- **THEN** the rate is created with no company and shows as a Group-scoped row
