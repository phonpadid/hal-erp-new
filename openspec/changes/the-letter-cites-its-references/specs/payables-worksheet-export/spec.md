## MODIFIED Requirements

### Requirement: The Description Is What The Document Says It Is For

The description cell SHALL be the document's `document_line.description` values, in line order,
joined with `; `, omitting empty ones.

When no line carries a description, the cell SHALL fall back to a form value chosen by
`form_field.field_name`, in this order:
1. The document's purpose/reason field: the first of `purpose`, `purposes`, `reason`, `reson`,
   `objective` (case-insensitive) that has a recorded value. These are the names the printed
   letter reads its ເຫດຜົນ from.
2. Otherwise, the first text-typed form value in `form_field.sort_order` whose field is neither the
   letter's subject field nor its references field, each found exactly as the letter finds it.

The field SHALL NOT be chosen by type and position alone.

The chosen value SHALL have HTML markup and entities stripped, whitespace collapsed, and be cut to
200 characters. When neither a line description nor a qualifying form value exists, the cell SHALL
be empty.

#### Scenario: Line descriptions are joined

- **GIVEN** a document with two lines described `A` and `B`
- **WHEN** the export is produced
- **THEN** its description cell is `A; B`

#### Scenario: A letter-style document is summarised from its form

- **GIVEN** a document whose only line has no description and whose form text field holds
  `<p>ຂໍສະເໜີ&nbsp;ເບີກງົບ</p>`
- **WHEN** the export is produced
- **THEN** its description cell is `ຂໍສະເໜີ ເບີກງົບ`

#### Scenario: The reason is the description even when the subject comes first

- **GIVEN** a document with no line descriptions, whose form has a `subject` field (sort order 1)
  holding `ຈັດຊື້ຄອມ` and a `Reson` field (sort order 2) holding `ເຄື່ອງເກົ່າເພ`
- **WHEN** the export is produced
- **THEN** its description cell is `ເຄື່ອງເກົ່າເພ`

#### Scenario: The subject is never the description

- **GIVEN** a document with no line descriptions whose only text field with a value is `subject`
- **WHEN** the export is produced
- **THEN** its description cell is empty

#### Scenario: A subject found by its label is not the description either

- **GIVEN** a document with no line descriptions whose only text field with a value is named
  `title` and labelled `ເລື່ອງ`
- **WHEN** the export is produced
- **THEN** its description cell is empty

#### Scenario: A differently named text field still serves when there is no reason field

- **GIVEN** a document with no line descriptions whose form has a single text field named `note`
  holding `ຄ່າເດີນທາງ`
- **WHEN** the export is produced
- **THEN** its description cell is `ຄ່າເດີນທາງ`

#### Scenario: The references are never the description

- **GIVEN** a document with no line descriptions whose form has a `ref` field (sort order 0) holding
  `ອີງຕາມ ການຕົກລົງ` and a `note` field holding `ຄ່າເດີນທາງ`
- **WHEN** the export is produced
- **THEN** its description cell is `ຄ່າເດີນທາງ`, and with only the `ref` value it is empty
