## ADDED Requirements

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
