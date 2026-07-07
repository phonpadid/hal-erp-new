# Multi-Currency Specification

## Purpose
Documents in any currency, budgets controlled in the company base currency, with
exchange rates locked onto documents at submit time.
## Requirements
### Requirement: Currency Registry
The system SHALL store currencies in `currency` with ISO 4217 code and decimal places
used for rounding.

#### Scenario: Zero-decimal currency rounds correctly
- GIVEN currency JPY with decimal_places 0
- WHEN a JPY amount is stored
- THEN it is rounded to whole units

### Requirement: Exchange Rate Lookup
The system SHALL resolve a rate from `exchange_rate` by selecting the latest row whose
`rate_date` is on or before the document date, for the configured `rate_type`, with an
optional company override over the group rate.

#### Scenario: Company override beats group rate
- GIVEN a group rate and a company-specific rate for the same pair and date
- WHEN a document in that company resolves its rate
- THEN the company-specific rate is used

### Requirement: Locked Rate on Document
The system SHALL store the resolved rate on the document at submit time and MUST NOT
recompute it later from current rates.

#### Scenario: Later rate change does not move the document
- GIVEN a submitted document with a locked rate
- WHEN the daily rate changes the next day
- THEN the document's converted amount stays unchanged

### Requirement: Budget Controlled in Base Currency

The system SHALL convert document amounts to the company base currency for budget checks,
reservation, and approval-threshold comparison using the `BUDGET_RATE` rate type (falling back to the
daily rate when no `BUDGET_RATE` exists for the pair), and SHALL stamp this **budget base** on the
document and its lines (`budget_exchange_rate`, `budget_base_total_amount`,
`document_line.budget_base_line_amount`) at submit. Budget reservation and its conversion to actual
SHALL both use the same persisted budget base so the reserve→actual ledger stays balanced. The
document SHALL also continue to record the **daily** rate (`exchange_rate`, `base_total_amount`,
`base_line_amount`) for display and the payment FX gain/loss; the daily rate is unchanged.

#### Scenario: Foreign-currency PR reserves at the budget rate

- **GIVEN** a company with base currency LAK, a daily THB→LAK rate, and a fixed `BUDGET_RATE` THB→LAK
- **WHEN** a THB PR is submitted
- **THEN** the reservation amount equals the THB total times the `BUDGET_RATE` in LAK, while the
  document records the daily rate and its daily base

#### Scenario: Approval threshold uses the budget base

- **GIVEN** a workflow step whose band is expressed in base currency
- **WHEN** a foreign-currency document routes
- **THEN** the band is compared against the document's `budget_base_total_amount` (the budget rate),
  not the daily base

#### Scenario: Settlement matches the reserved budget base

- **WHEN** the document's budget is converted to actual on approval
- **THEN** it settles against the same budget base it reserved, leaving zero outstanding reserved

#### Scenario: No budget rate falls back to the daily rate

- **GIVEN** no `BUDGET_RATE` exists for the currency pair
- **WHEN** the document is submitted
- **THEN** the budget base equals the daily base and budget control behaves as before

### Requirement: FX Difference Goes to Accounting

When an actual payment is recorded at a rate different from the locked rate, the system SHALL compute
the FX delta as the base-actual amount (the document total at the actual rate, in base currency) minus
the base-locked amount, persist it on the payment record, and report it to accounting (the
`payment.settled` event) as an FX gain/loss. The budget `ACTUAL` SHALL remain at the locked basis and
the system MUST NOT charge the FX delta to the budget.

#### Scenario: Payment at a worse rate does not overrun budget silently

- **GIVEN** a document actualized (settled) at the locked rate
- **WHEN** the payment is recorded at a higher actual rate
- **THEN** the budget keeps its `ACTUAL` at the locked basis and the FX delta is recorded and reported
  separately as a loss
- **AND** no `budget_txn` is written for the FX difference

#### Scenario: FX delta is reported to accounting

- **WHEN** a payment with a non-zero FX delta is recorded
- **THEN** a `payment.settled` event carries the locked rate, actual rate, base amounts, delta, and kind
  for the external accounting system

### Requirement: Currency and Rate Administration

The system SHALL let authorized users (`CURRENCY_MANAGE`) maintain the `currency`
registry and `exchange_rate` rows (group-wide or per-company override). Currencies SHALL
be deactivated via `is_active = false`, never hard-deleted, so documents that reference a
currency stay intact. Each exchange-rate row SHALL stamp its `created_by` from the
request context.

#### Scenario: Deactivate a currency instead of deleting it

- **WHEN** an administrator removes a currency
- **THEN** the `currency` row is retained with `is_active = false` and no row is deleted

#### Scenario: Record a company-override rate

- **WHEN** an administrator with `CURRENCY_MANAGE` adds a rate for a specific company
- **THEN** an `exchange_rate` row is created with that `company_id` and `created_by` set

### Requirement: Identity and Inverse Resolution

When resolving a rate, if the source and target currency are the same the system SHALL
use a rate of 1 without requiring an `exchange_rate` row. If no row exists for the
requested direction but one exists for the reverse pair, the system MAY resolve using the
inverse (1 / rate) of the reverse pair.

#### Scenario: Same currency resolves to one

- **WHEN** a document's currency equals the company base currency
- **THEN** resolution returns a rate of 1 and no `exchange_rate` lookup is required

#### Scenario: Inverse used when only the reverse pair exists

- **GIVEN** an `exchange_rate` for USD→THB but none for THB→USD
- **WHEN** a THB→USD rate is resolved
- **THEN** the inverse (1 / the USD→THB rate) is used

### Requirement: Currency-Aware Conversion Rounding

When converting an amount to a target currency, the system SHALL multiply by the
resolved rate using exact decimal arithmetic (never floating point) and round the result
to the target currency's `decimal_places`.

#### Scenario: Convert into a zero-decimal currency

- **GIVEN** a target currency JPY with `decimal_places` 0
- **WHEN** an amount is converted into JPY
- **THEN** the result is rounded to whole units

#### Scenario: Resolution is as-of-deterministic

- **GIVEN** rates dated 2026-01-01 and 2026-02-01 for the same pair and type
- **WHEN** a rate is resolved as of 2026-01-15
- **THEN** the 2026-01-01 rate is used and the later 2026-02-01 rate does not affect it

### Requirement: Selectable Currencies for Document Creation

The system SHALL expose a read that returns the currencies a document creator may choose from,
authorized by the `DOC_CREATE` permission code (not `CURRENCY_VIEW`). The read SHALL return only
active currencies (`is_active = true`) and only the selection fields for each — `code`, `name`,
`symbol`, and `decimalPlaces`. This read is additive: the administrative currency reads and
writes (the paginated list including inactive currencies under `CURRENCY_VIEW`, and create /
update / deactivate under `CURRENCY_MANAGE`) remain unchanged.

#### Scenario: Creator without CURRENCY_VIEW can list selectable currencies

- **GIVEN** a user who holds `DOC_CREATE` but not `CURRENCY_VIEW`
- **WHEN** the user requests the selectable-currencies read
- **THEN** the active currencies are returned with `code`, `name`, `symbol`, and `decimalPlaces`,
  and the request is not rejected for lacking `CURRENCY_VIEW`

#### Scenario: Inactive currencies are excluded

- **GIVEN** a currency whose `is_active` is false
- **WHEN** a user requests the selectable-currencies read
- **THEN** that currency is not returned

#### Scenario: Selectable read requires DOC_CREATE

- **GIVEN** a user who holds neither `DOC_CREATE` nor `CURRENCY_VIEW`
- **WHEN** the user requests the selectable-currencies read
- **THEN** the request is rejected as unauthorized

