# web-i18n

## Purpose
Localization of the Vue web application's user-facing UI. All display chrome (titles, labels,
buttons, table headers, status tags, empty states, dialog and toast text) is rendered through the
i18n layer rather than hardcoded in templates. The app ships complete `la` (default) and `en`
(fallback) catalogs, applies locale changes live without a reload, persists the chosen locale via
per-user settings, and formats dates and plain numeric counts per the active locale while monetary
amounts continue to use the currency's `decimal_places` and are never carried as JavaScript numbers.

## Requirements

### Requirement: Full Page Localization

The web app SHALL render all user-facing UI text on every authenticated page and shared component
through the i18n layer. No display string (page titles, table headers, status labels, buttons,
empty states, dialog text, toast messages, form field labels) SHALL be hardcoded in a template.
Server-originated dynamic data (e.g. company names, document content) is out of scope and rendered
as received.

#### Scenario: A page renders its text from the active locale

- **WHEN** a signed-in user opens any in-app page in the active locale
- **THEN** all of the page's UI chrome (titles, labels, buttons, table headers, status tags, empty
  states) is shown from the i18n catalog for that locale, with no hardcoded display string

#### Scenario: No untranslated literal text remains

- **WHEN** the views and shared components are checked for hardcoded display literals
- **THEN** none are found except explicitly marked non-translatable tokens (codes, symbols)

### Requirement: Complete Locale Catalogs

The web app SHALL provide complete `la` and `en` catalogs, with `la` as the default locale and `en`
as the fallback. The two catalogs SHALL be key-complete: every key present in one locale SHALL be
present in the other.

#### Scenario: Default locale on first load

- **WHEN** a user with no saved locale preference loads the app
- **THEN** the UI renders in `la`

#### Scenario: Fallback fills a missing key

- **WHEN** a string is requested for a key not present in the active locale
- **THEN** the `en` value is shown instead of a blank or the raw key

#### Scenario: Catalogs stay in sync

- **WHEN** the catalog key sets for `la` and `en` are compared
- **THEN** they are identical (no key exists in only one locale)

### Requirement: Live Locale Switching

The web app SHALL apply a locale change immediately across all currently rendered pages without a
reload, and the chosen locale SHALL be persisted via the per-user settings.

#### Scenario: Switching locale re-renders the current page

- **WHEN** the user switches the locale from the topbar or configurator
- **THEN** the visible page's text updates to the new locale without a page reload

#### Scenario: Chosen locale persists

- **WHEN** the user switches locale and later signs in again
- **THEN** the app loads in the previously chosen locale

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
