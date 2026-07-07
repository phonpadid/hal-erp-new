## ADDED Requirements

### Requirement: Create Wizard Currency Picker Available to Creators

The Create Document wizard SHALL populate its document-currency picker from the
selectable-currencies read (active currencies with `code`, `name`, `symbol`, `decimalPlaces`),
which is authorized by `DOC_CREATE`. A `DOC_CREATE` user SHALL be able to choose the document
currency without holding `CURRENCY_VIEW`; the picker SHALL default to the company base currency
and the chosen currency SHALL be sent on save (the server locks the authoritative rate at
submit). The currency-administration pages remain gated by their own permissions
(`CURRENCY_VIEW` / `CURRENCY_MANAGE`) and are unaffected.

#### Scenario: Creator without CURRENCY_VIEW can choose a currency

- **GIVEN** a signed-in user holding `DOC_CREATE` but not `CURRENCY_VIEW`
- **WHEN** the user opens the Create wizard
- **THEN** the currency picker is populated with the active currencies and no 403 blocks the
  wizard

#### Scenario: Currency picker defaults to the company base currency

- **WHEN** the wizard first renders for a new document
- **THEN** the selected currency defaults to the company base currency
