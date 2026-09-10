## MODIFIED Requirements

### Requirement: Selectable Currencies for Document Creation

The system SHALL expose a read that returns the currencies a user may choose from, authorized when
the caller holds ANY of `DOC_CREATE`, `CURRENCY_VIEW`, or `VENDOR_BANK_MANAGE`. The read SHALL
return only active currencies (`is_active = true`) and only the selection fields for each — `code`,
`name`, `symbol`, and `decimalPlaces`. Requiring `DOC_CREATE` alone left the currency picker empty
for a `VENDOR_BANK_MANAGE` user recording a vendor's payee account, and left every amount that user
reads formatted at a default two decimal places, since amount formatting resolves `decimal_places`
from this same read. This read is additive: the administrative currency reads and writes (the
paginated list including inactive currencies under `CURRENCY_VIEW`, and create / update /
deactivate under `CURRENCY_MANAGE`) remain unchanged.

#### Scenario: Creator without CURRENCY_VIEW can list selectable currencies

- **GIVEN** a user who holds `DOC_CREATE` but not `CURRENCY_VIEW`
- **WHEN** the user requests the selectable-currencies read
- **THEN** the active currencies are returned with `code`, `name`, `symbol`, and `decimalPlaces`,
  and the request is not rejected for lacking `CURRENCY_VIEW`

#### Scenario: A vendor bank manager can list selectable currencies

- **GIVEN** a user who holds `VENDOR_BANK_MANAGE` but neither `DOC_CREATE` nor `CURRENCY_VIEW`
- **WHEN** the user requests the selectable-currencies read
- **THEN** the active currencies are returned rather than the request being rejected

#### Scenario: A currency administrator can list selectable currencies

- **GIVEN** a user who holds `CURRENCY_VIEW` but not `DOC_CREATE`
- **WHEN** the user requests the selectable-currencies read
- **THEN** the active currencies are returned rather than the request being rejected

#### Scenario: Inactive currencies are excluded

- **GIVEN** a currency whose `is_active` is false
- **WHEN** a user requests the selectable-currencies read
- **THEN** that currency is not returned

#### Scenario: The selectable read still requires one of the three codes

- **GIVEN** a user who holds none of `DOC_CREATE`, `CURRENCY_VIEW`, or `VENDOR_BANK_MANAGE`
- **WHEN** the user requests the selectable-currencies read
- **THEN** the request is rejected as unauthorized

## ADDED Requirements

### Requirement: An Endpoint May Require Any One of Several Permission Codes

The authorization guard SHALL support gating an endpoint on ANY ONE of a set of permission codes, in
addition to the existing gate that requires ALL of a set. Where both gates are declared on one
endpoint, both SHALL be satisfied for the request to proceed. Authorization SHALL continue to read
permission codes only, never role names.

#### Scenario: Holding one of the listed codes is enough

- **GIVEN** an endpoint gated on ANY of `A`, `B`, `C`
- **WHEN** a user holding only `B` calls it
- **THEN** the request proceeds

#### Scenario: Holding none of the listed codes is refused

- **GIVEN** an endpoint gated on ANY of `A`, `B`, `C`
- **WHEN** a user holding none of them calls it
- **THEN** the request is rejected as unauthorized

#### Scenario: An all-of gate is unaffected

- **GIVEN** an endpoint gated on ALL of `A` and `B`
- **WHEN** a user holding only `A` calls it
- **THEN** the request is rejected as unauthorized
