## MODIFIED Requirements

### Requirement: Locale-Aware Formatting

The web app SHALL format dates and plain numeric counts according to the active locale. Dates
SHALL be rendered through a single shared date-formatting helper (`formatDate`) backed by a
date library configured for the active locale (including Lao, `lo`), so date rendering is
consistent across pages and not hand-formatted per view. Monetary amounts SHALL continue to be
formatted using the currency's `decimal_places` and SHALL never be carried or rendered as a
JavaScript number. Monetary amounts SHALL additionally be rendered with locale-aware
thousands grouping (e.g. `1000000.00` shown as `1,000,000.00`), where the grouping and decimal
separators follow the active locale. The grouping SHALL be derived from the decimal-string value
(via the shared money helper) and SHALL NOT be produced by coercing the amount to a JavaScript
number; the fractional length SHALL come from the currency's `decimal_places`, including the case
of `decimal_places` `0`, which yields a grouped integer with no fractional part.

#### Scenario: Dates follow the active locale

- **WHEN** a date is displayed in a page
- **THEN** it is formatted by the shared `formatDate` helper according to the active locale

#### Scenario: Money respects currency precision

- **WHEN** a monetary amount is displayed
- **THEN** it is formatted using the currency's `decimal_places` and is not coerced to a JS number

#### Scenario: Money is shown with thousands grouping

- **WHEN** a monetary amount with four or more integer digits is displayed
- **THEN** its integer digits are grouped in threes using the active locale's grouping separator
  (e.g. `1000000.00` renders as `1,000,000.00`)

#### Scenario: Grouping respects a zero-decimal currency

- **WHEN** a monetary amount in a currency whose `decimal_places` is `0` is displayed
- **THEN** the integer digits are grouped and no decimal separator or fractional digits are shown

#### Scenario: Grouping derives from the decimal string

- **WHEN** a large monetary amount is formatted for display
- **THEN** the grouped output is produced from the decimal-string value through the shared money
  helper and the amount is never converted to a JavaScript number to apply the grouping
