## ADDED Requirements

### Requirement: The Department Form Offers The Paper Abbreviation

The department create and edit forms SHALL offer an optional **short name** field bound to
`department.short_name`, validated by the shared Zod schema with the same bound the server applies
(trimmed, at most 20 characters), and the hierarchy list SHALL show it beside the code. The label
and hint SHALL be rendered through i18n in `en`, `la` and `zh`.

#### Scenario: Setting the abbreviation

- **WHEN** a `DEPARTMENT_MANAGE` user edits a department and enters `ບຫ` as its short name
- **THEN** the form sends `shortName` and the list shows `ບຫ` beside that department's code
