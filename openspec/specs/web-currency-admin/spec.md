# web-currency-admin

## Purpose
The Vue currency-administration area: a permission-gated screen where users manage the
company-base and foreign currencies and the exchange rates that feed the locked-FX-at-submit
rule. A `CURRENCY_VIEW` user can list currencies and exchange rates (filterable by from/to
pair); a `CURRENCY_MANAGE` user can create and edit currencies (ISO code, name, symbol,
decimal places, active state) and add exchange rates (from → to, rate, effective date, rate
type). Exchange rates are append-only — a correction or a new effective date is recorded as a
new row, never an edit — and rate amounts are carried as decimal strings, never JS numbers.
Navigation, tabs, and actions are gated by the `CURRENCY_VIEW` and `CURRENCY_MANAGE` permission
codes as a UX-only guard; the server remains authoritative.
## Requirements
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

### Requirement: Permission-Gated Currency Admin

The currency navigation, tabs, and actions SHALL be shown by permission code — viewing by
`CURRENCY_VIEW`, create/edit/add by `CURRENCY_MANAGE` (UX only; the server still enforces).

#### Scenario: Currency admin hidden without permission

- **WHEN** a user without `CURRENCY_VIEW` is signed in
- **THEN** the Currencies navigation entry is not shown

