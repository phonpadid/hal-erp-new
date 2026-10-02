## MODIFIED Requirements

### Requirement: Letter Body from Configured Form Fields

The exported PDF SHALL render the letter body from the field values configured for the
document's `form_template` (the fields defined via the form configuration), in
`form_field.sort_order` order, each labelled by its `form_field.field_label`. Only fields
that have a recorded value for the document SHALL appear.

The field whose value is printed on the subject line (see *The Letter's Subject Comes From The
Form's Subject Field*) SHALL NOT also appear in the body. A reader sees each value once, in the
place its name gives it.

#### Scenario: Body follows the configured form

- **GIVEN** a document whose form template defines fields A, B, C in sort order and the
  document has values for A and C
- **WHEN** the PDF is exported
- **THEN** the body shows A then C, each with its `field_label`, and omits B

#### Scenario: The subject is not repeated in the body

- **GIVEN** a form with fields `subject` (label ເລື່ອງ) and `Reson` (label ເຫດຜົນ), both with
  values
- **WHEN** the letter is exported
- **THEN** the subject value appears on the ເລື່ອງ line only, and the body shows ເຫດຜົນ with its
  value

## ADDED Requirements

### Requirement: The Letter's Subject Comes From The Form's Subject Field

The proposal letter's subject line (`ເລື່ອງ:`) SHALL print the recorded value of the document's
subject field, found in this order:
1. The form field whose `form_field.field_name` is `subject`, matched case-insensitively, with
   `topic` accepted as an alias. When both are present, `subject` wins.
2. Only when no field bears either name: the form field whose `form_field.field_label` is
   `ເລື່ອງ`, compared after trimming whitespace and a trailing colon.

The name SHALL take precedence because it is fixed once the field exists, while a label is
translated per company and may be edited. The label fallback exists so that a form configured with
a different field name but captioned ເລື່ອງ still fills the line. The field SHALL never be chosen by
`field_type`, because several fields may share a type.

The value SHALL be printed as plain text, with HTML markup and entities stripped and whitespace
collapsed. When the form has no such field, or the document recorded no non-empty value for it,
the line SHALL print the dotted blank it prints today, so it can be written by hand.

No column SHALL be added to `document` for this. The subject is configuration: a form that should
print one carries a `subject` field, and a form that does not carry one prints the blank.

#### Scenario: A form with a subject field prints it

- **GIVEN** a document whose form has a `text` field named `subject`, labelled ເລື່ອງ, holding
  `ຂໍອະນຸມັດຈັດຊື້ຄອມພິວເຕີ`
- **WHEN** its letter is exported
- **THEN** the subject line reads `ເລື່ອງ: ຂໍອະນຸມັດຈັດຊື້ຄອມພິວເຕີ`

#### Scenario: The name decides, not the order or the type

- **GIVEN** a form whose first text field is `subject` and whose second is `Reson`
- **WHEN** the letter is exported
- **THEN** the `subject` value is on the ເລື່ອງ line and the `Reson` value is under ເຫດຜົນ in the
  body, and swapping their sort order changes neither

#### Scenario: The name is matched without regard to case

- **GIVEN** a form field named `Subject`
- **WHEN** the letter is exported
- **THEN** its value is printed on the subject line

#### Scenario: A field captioned ເລື່ອງ is used when no field is named subject

- **GIVEN** a form with a text field named `title`, labelled `ເລື່ອງ:`, holding `ຂໍເບີກຄ່າເດີນທາງ`,
  and no field named `subject` or `topic`
- **WHEN** the letter is exported
- **THEN** the subject line reads `ເລື່ອງ: ຂໍເບີກຄ່າເດີນທາງ`, and that field is not repeated in the
  body

#### Scenario: The name wins over the label

- **GIVEN** a form with a field named `subject` holding `A`, and another field named `heading`
  labelled `ເລື່ອງ` holding `B`
- **WHEN** the letter is exported
- **THEN** the subject line prints `A`, and `B` stays in the body under its label

#### Scenario: A form without a subject field keeps the blank line

- **GIVEN** a form whose fields are `date`, `Reson` and `file`
- **WHEN** the letter is exported
- **THEN** the subject line is `ເລື່ອງ:` followed by the dotted blank

#### Scenario: An empty subject keeps the blank line

- **GIVEN** a form with a `subject` field whose recorded value is empty or only markup
- **WHEN** the letter is exported
- **THEN** the subject line is the dotted blank

### Requirement: Signatures Are Centred In Their Column

On the proposal letter, each stamped signature image SHALL be scaled to fit its column's signature
area without distortion, and SHALL be centred within that area both horizontally and vertically,
whatever its aspect ratio. The heading, the dotted baseline, the name and the date SHALL stay
centred on the same column axis, so the whole block reads as one centred unit.

#### Scenario: A tall, narrow signature is centred

- **GIVEN** a proposer whose stamped signature is taller than it is wide
- **WHEN** the letter is exported
- **THEN** the image's horizontal centre is the centre of the proposer's column

#### Scenario: A wide signature is centred

- **GIVEN** an approver whose stamped signature is much wider than it is tall
- **WHEN** the letter is exported
- **THEN** the image fits within the column's signature area and its horizontal centre is the
  column's centre
