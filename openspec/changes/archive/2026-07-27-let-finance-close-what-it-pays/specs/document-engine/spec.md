## ADDED Requirements

### Requirement: A Choice Field Declares The Values It Accepts

Reading a document type's form SHALL, for each field that constrains its input to a fixed set of values, return that set as an array of strings alongside the field's other attributes. A field that does not constrain its input SHALL omit the key entirely rather than carry an empty or null one, so that its presence identifies a choice field without the caller inspecting the field type.

Where the stored options cannot be read as an array of strings, the field SHALL omit the key and the rest of the form SHALL be returned unchanged. A form read is how a caller learns every field on the form; one unreadable row SHALL NOT deny it the others.

#### Scenario: A choice field carries its permitted values

- **GIVEN** a form with a field constrained to a fixed set of values
- **WHEN** the form is read
- **THEN** that field carries those values as an array of strings

#### Scenario: A free-text field carries no set of values

- **GIVEN** a form with a field that accepts free text
- **WHEN** the form is read
- **THEN** that field has no permitted-values key at all

#### Scenario: An unreadable set does not deny the caller the rest of the form

- **GIVEN** a field whose stored options cannot be read as an array of strings
- **WHEN** the form is read
- **THEN** that field omits its permitted values and every other field is returned as normal
