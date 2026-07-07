## MODIFIED Requirements

### Requirement: Locale-Aware Formatting

The web app SHALL format dates and plain numeric counts according to the active locale. Dates
SHALL be rendered through a single shared date-formatting helper (`formatDate`) backed by a
date library configured for the active locale (including Lao, `lo`), so date rendering is
consistent across pages and not hand-formatted per view. Monetary amounts SHALL continue to be
formatted using the currency's `decimal_places` and SHALL never be carried or rendered as a
JavaScript number.

#### Scenario: Dates follow the active locale

- **WHEN** a date is displayed in a page
- **THEN** it is formatted by the shared `formatDate` helper according to the active locale

#### Scenario: Money respects currency precision

- **WHEN** a monetary amount is displayed
- **THEN** it is formatted using the currency's `decimal_places` and is not coerced to a JS number
