## ADDED Requirements

### Requirement: The Document Type Form Names The Letter's Addressee

The document-type form SHALL offer an optional free-text field for the type's letter addressee,
bound to `document_type.letter_addressee` and shown beside the other per-type print settings. Its
help text SHALL state what an empty field means — the letter addresses the company's managing
director — so an administrator can tell "not set" from "set to something" without exporting a PDF to
find out. Submitting the field empty SHALL send a cleared value rather than an empty string, so the
server stores NULL.

The field SHALL be gated by `DOC_CONFIG_MANAGE` like the rest of the form, and a server refusal
SHALL be shown in the reader's language like every other configuration write.

#### Scenario: The field is offered and saved

- **WHEN** an administrator opens the document-type form and types an addressee
- **THEN** the value is saved on the type and the type's letters address it

#### Scenario: An empty field reads as the default, not as blank

- **GIVEN** a type whose `letter_addressee` is NULL
- **WHEN** the administrator opens its form
- **THEN** the field is empty and its help text says the letter will address the company's managing director

#### Scenario: Clearing the field restores the default

- **GIVEN** a type whose `letter_addressee` is set
- **WHEN** the administrator empties the field and saves
- **THEN** the stored value is NULL and the form shows the default help text again
