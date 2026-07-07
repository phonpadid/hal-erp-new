## ADDED Requirements

### Requirement: Currency Management

The web app SHALL let a `CURRENCY_VIEW` user list currencies and a `CURRENCY_MANAGE` user create
and edit them (ISO code, name, symbol, decimal places, active state), validated client-side
against the shared schema.

#### Scenario: Create a currency

- **WHEN** a `CURRENCY_MANAGE` user submits a valid new currency
- **THEN** it appears in the currency list

#### Scenario: Edit a currency

- **WHEN** the user edits a currency's name, symbol, or decimal places
- **THEN** the change is saved and reflected in the list

### Requirement: Exchange Rate Management

The web app SHALL let a `CURRENCY_VIEW` user list exchange rates (filterable by from/to currency)
and a `CURRENCY_MANAGE` user add a rate (from → to, rate, effective date, rate type). Rates are
append-only: a correction or a new effective date is recorded as a new row, never an edit.

#### Scenario: Add an exchange rate

- **WHEN** the user adds a rate for a from→to pair on a date
- **THEN** it appears in the rate list

#### Scenario: Filter rates by currency pair

- **WHEN** the user filters by a from and to currency
- **THEN** only matching rates are listed

### Requirement: Permission-Gated Currency Admin

The currency navigation, tabs, and actions SHALL be shown by permission code — viewing by
`CURRENCY_VIEW`, create/edit/add by `CURRENCY_MANAGE` (UX only; the server still enforces).

#### Scenario: Currency admin hidden without permission

- **WHEN** a user without `CURRENCY_VIEW` is signed in
- **THEN** the Currencies navigation entry is not shown
