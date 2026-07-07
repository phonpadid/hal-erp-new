## ADDED Requirements

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
