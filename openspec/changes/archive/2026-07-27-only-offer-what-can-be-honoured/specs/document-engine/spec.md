## ADDED Requirements

### Requirement: A Choice Field Accepts Only What It Offers

Writing a value to a field that declares a fixed set of permitted values SHALL be refused unless the value is one of them. The refusal SHALL name the value and the values that would have been accepted, so the caller can correct it without consulting a separate document.

The rule SHALL be derived from the field's own declared values and SHALL NOT be specialised per document type: a type that offers a different set SHALL be governed by this without any change to code.

A write carrying several values SHALL be refused in full when any one of them is not offered — no value in that write SHALL be stored — so that a caller never has to reason about which half of its request took effect.

An empty value SHALL be accepted and SHALL clear the field. Whether the field was permitted to be empty is decided when the document is submitted, not here.

Where a field's declared values cannot be read as a set of strings, that field SHALL NOT be enforced and the write SHALL proceed. One unreadable configuration row SHALL NOT stop documents being filled in.

#### Scenario: An offered value is stored

- **GIVEN** a field offering a fixed set of values
- **WHEN** one of those values is written
- **THEN** it is stored

#### Scenario: A value that was never offered is refused

- **GIVEN** a field offering a fixed set of values
- **WHEN** a value outside that set is written
- **THEN** the write is refused as a validation failure, and the message names both the rejected value and the accepted ones

#### Scenario: A refused value leaves the rest of the write unwritten

- **GIVEN** a write carrying a valid value for one field and an unoffered value for another
- **WHEN** the write is attempted
- **THEN** it is refused and neither value is stored

#### Scenario: Clearing a choice field is allowed

- **GIVEN** a field offering a fixed set of values, already carrying one of them
- **WHEN** an empty value is written to it
- **THEN** the field is cleared

#### Scenario: A free-text field is unaffected

- **GIVEN** a field that declares no fixed set of values
- **WHEN** any value is written to it
- **THEN** it is stored

#### Scenario: An unreadable set is not enforced

- **GIVEN** a field whose declared values cannot be read as a set of strings
- **WHEN** a value is written to it
- **THEN** the value is stored rather than refused
