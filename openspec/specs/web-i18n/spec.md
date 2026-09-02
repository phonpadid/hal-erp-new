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

### Requirement: A Catalog Value Is Written In Its Own Locale's Script

Every value in a locale catalog SHALL be written in the script that locale uses. A `la` value SHALL
NOT contain a codepoint from the Thai block (U+0E00–U+0E7F), and an `en` value SHALL NOT contain a
codepoint from the Lao or Thai blocks. Lao and Thai are visually close enough that a spliced glyph
survives review — `ພາສີຫັກ ณ ທີ່ຈ່າຍ` and `ຍັງບໍ່ໄດ້ກรอก` both shipped — so the rule SHALL be
enforced by an automated guard rather than by reading.

A value MAY carry a codepoint outside its locale's script where the token is genuinely
non-translatable — a currency symbol, a product name, a document-number prefix. Such a value SHALL
be marked explicitly, and the guard SHALL fail on any unmarked occurrence.

#### Scenario: A Thai letter in a Lao value fails the build

- **WHEN** the catalog guard runs over the `la` catalog and a value contains a Thai codepoint that
  is not explicitly marked non-translatable
- **THEN** the guard fails and names the key and the offending character

#### Scenario: A marked non-translatable token passes

- **GIVEN** a catalog value whose foreign token is a brand, symbol, or code and is marked as
  non-translatable
- **WHEN** the catalog guard runs
- **THEN** the value passes

#### Scenario: The guard runs with the existing catalog guards

- **WHEN** the web test suite runs
- **THEN** the script guard runs alongside the key-parity and no-literal-text guards, so a catalog
  regression fails the same run that a parity regression would

### Requirement: A Locale Catalog Carries No Untranslated Foreign Token

A catalog value SHALL NOT present an untranslated word or acronym from another language as though it
were display text in the active locale. An abbreviation that a reader of that locale would not use
at work — `WHT` for withholding tax, `SLA` for an approval deadline — SHALL be replaced by a term in
that locale, and the same concept SHALL use one term across every screen. Where a value is a
technical identifier rather than prose (an HTTP status, a file extension), it is out of scope.

A code SHALL NOT reach the display layer unresolved. Where a value shown to a user has both a code
and a display name, the name SHALL be what is rendered — including inside chart axes, legends, and
tooltips, which are as user-facing as a table cell.

Which of the two carries the name differs by kind, and the rule follows the data rather than
overriding it. A fixed status such as `document.status` has no per-company name, so its label comes
from the catalog. A document type and a document category are per-company configuration
(`document_type.name`, `document_category.name`) — their names SHALL come from the record, never
from a shipped catalog, because a catalog cannot hold a code a customer invents.

#### Scenario: One concept has one term

- **WHEN** the same tax or deadline concept is displayed on two different screens in the same locale
- **THEN** both screens show the same term, and neither shows a bare foreign-language acronym

#### Scenario: A code in a chart is resolved

- **WHEN** a chart renders a document type or category as an axis label, legend entry, or tooltip
- **THEN** it displays that record's configured name, not its code

#### Scenario: A view does not show one value two ways

- **WHEN** a single view renders the same document type in a chart and in a table
- **THEN** both render the same name

#### Scenario: A configured name is not sought in the catalog

- **WHEN** a document type or category is displayed
- **THEN** its name comes from the record and no catalog key is defined for its code
