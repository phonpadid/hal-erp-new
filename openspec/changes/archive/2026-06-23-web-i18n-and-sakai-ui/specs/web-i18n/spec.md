## ADDED Requirements

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

The web app SHALL format dates and plain numeric counts according to the active locale through the
i18n formatting layer. Monetary amounts SHALL continue to be formatted using the currency's
`decimal_places` and SHALL never be carried or rendered as a JavaScript number.

#### Scenario: Dates follow the active locale

- **WHEN** a date is displayed in a page
- **THEN** it is formatted according to the active locale's date format

#### Scenario: Money respects currency precision

- **WHEN** a monetary amount is displayed
- **THEN** it is formatted using the currency's `decimal_places` and is not coerced to a JS number
