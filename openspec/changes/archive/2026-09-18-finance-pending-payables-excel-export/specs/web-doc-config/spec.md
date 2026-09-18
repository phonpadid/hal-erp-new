## ADDED Requirements

### Requirement: The Document Type Form Offers The Paper Abbreviation

The document-type create and edit forms SHALL offer an optional **short name** field bound to
`document_type.short_name`, validated by the shared Zod schema with the same bound the server
applies (trimmed, at most 20 characters), and the list SHALL show it beside the code so an
administrator can see which types still stamp their code. The field's label and hint SHALL be
rendered through i18n in `en`, `la` and `zh`.

#### Scenario: Setting the abbreviation

- **WHEN** a `DOC_CONFIG_MANAGE` user edits a type and enters `ຈຊຈ` as its short name
- **THEN** the form sends `shortName` and the list shows `ຈຊຈ` beside that type's code

#### Scenario: Leaving it blank sends nothing

- **WHEN** the short-name field is left empty
- **THEN** the form sends `shortName` as null and the server stores null
