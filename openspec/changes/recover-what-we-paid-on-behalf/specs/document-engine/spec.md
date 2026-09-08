# document-engine Specification (delta)

## ADDED Requirements

### Requirement: A Successor Carries The Field Values Its Own Form Asks For

Creating a document from a predecessor SHALL fill each field of the successor's published form whose
`form_field.field_name` matches a field on the predecessor's form with the predecessor's stored
`doc_field_value` for that name. A field the successor's form does not declare SHALL NOT be carried,
and a field the predecessor left empty SHALL leave the successor's empty.

Matching SHALL be by field NAME, not by `form_field.id`: the two forms belong to different document
types and share no field rows, and a name is the only thing about a field that means the same on both
sides.

A value the successor's own field definition would refuse SHALL NOT be written — a value outside a
dropdown's `options_json` above all. The successor's form is the authority on what its fields may
hold, and a type that narrows an option list must not receive a value through inheritance that a
person could not have entered.

Inheritance SHALL write no `budget_txn`, no `quota_usage` and no approval row: it fills a DRAFT, and
the successor still takes its own holds at its own submit.

Inheritance exists because a successor raised automatically has nobody to fill it in. A recovery
raised by `CREATE_SUCCESSOR` carries the amount it inherits and, without this, nothing that says what
it is for or who it is against — leaving the person who works it to find the predecessor by hand, and
leaving every report about successors unable to group by anything the business recognises.

#### Scenario: A field both forms declare is carried

- **GIVEN** a predecessor whose form has `liableParty` = `BRANCH` and a successor type whose form also declares `liableParty`
- **WHEN** the successor is created from it
- **THEN** the successor's `liableParty` field value is `BRANCH`

#### Scenario: A field only the predecessor declares is not carried

- **GIVEN** a predecessor whose form has `claimKind` = `LOST` and a successor type whose form does not declare `claimKind`
- **WHEN** the successor is created from it
- **THEN** the successor holds no value for `claimKind`

#### Scenario: A value the successor's own field would refuse is not written

- **GIVEN** a predecessor whose `settlementKind` is `CASH` and a successor whose `settlementKind` offers only `TRANSFER`
- **WHEN** the successor is created from it
- **THEN** the successor's `settlementKind` is left empty rather than set to a value its form does not offer

#### Scenario: An empty predecessor field leaves the successor's empty

- **GIVEN** a predecessor that left `orgUnit` empty and a successor whose form declares `orgUnit`
- **WHEN** the successor is created from it
- **THEN** the successor's `orgUnit` is empty, and no placeholder is written

#### Scenario: Inheritance takes no holds

- **WHEN** a successor is created from a predecessor and inherits field values
- **THEN** no `budget_txn` and no `quota_usage` row is written by the creation
