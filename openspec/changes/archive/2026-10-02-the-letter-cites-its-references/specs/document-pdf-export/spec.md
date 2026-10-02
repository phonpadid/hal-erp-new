## ADDED Requirements

### Requirement: The Letter Lists Its References Under The Subject

The letter SHALL print, directly beneath the subject line, the recorded value of the document's
references field, found in this order:
1. The form field whose `form_field.field_name` is `ref`, matched case-insensitively, with `refs`,
   `reference` and `references` accepted as aliases, in that order of preference.
2. Only when no field bears one of those names: the form field whose `form_field.field_label` is
   `ອີງຕາມ`, compared after trimming whitespace and a trailing colon.

The field SHALL never be chosen by `field_type`.

The value SHALL be reduced to plain text and split into one entry per line (a rich-text paragraph
or list item is a line). Blank lines SHALL be dropped. An entry written with a number — an item of
a numbered list, or a line starting `1.` or `1)` — SHALL be drawn behind that number. Any other
entry SHALL be drawn behind a dash, with a leading dash or bullet typed by the requester removed so
it is not doubled. The marker SHALL stand in the column the subject line starts in, with the text in
a column of its own so that wrapped lines align under the text, not under the marker.

When the form has no such field, or its value has no non-blank line, no block SHALL be printed. The
field used SHALL NOT also appear in the letter body.

#### Scenario: Each line of the ref field is a dashed entry

- **GIVEN** a form with a `subject` field, a `ref` field holding two lines
  `- ອີງຕາມ ກ;` and `- ອີງຕາມ ຂ.`, and a `Reson` field
- **WHEN** the letter is exported
- **THEN** beneath the ເລື່ອງ line the letter prints `ອີງຕາມ ກ;` and `ອີງຕາມ ຂ.`, each behind one
  dash, and the body shows only ເຫດຜົນ

#### Scenario: A numbered list keeps its numbers

- **GIVEN** a `ref` field whose value is a numbered list of two items (saved by the editor as `<ol>`)
- **WHEN** the letter is exported
- **THEN** the two entries are drawn behind `1.` and `2.`, not behind dashes

#### Scenario: A form without a ref field prints no block

- **GIVEN** a form with no field named `ref` (or an alias) and none captioned ອີງຕາມ
- **WHEN** the letter is exported
- **THEN** the proposer line follows the ເລື່ອງ line with no references block

#### Scenario: A blank ref prints no block

- **GIVEN** a form with a `ref` field whose recorded value is empty or only markup
- **WHEN** the letter is exported
- **THEN** no references block is printed and the field is not in the body

## MODIFIED Requirements

### Requirement: Lao-Script Font Rendering

The exported PDF SHALL embed one font and use it as the default text face for the letter and every
sheet. The font SHALL draw Lao in Phetsarath OT, so that Lao characters in the national header,
company name, labels, proposer line, and body render as legible glyphs rather than missing-glyph
boxes. It SHALL draw ASCII digits, Latin letters and Latin punctuation in a Times New Roman design:
Tinos, which matches Times New Roman glyph for glyph and width for width and, unlike Times New
Roman, may be redistributed.

The two SHALL be merged into a single font file rather than switched between while drawing, so a
line is measured, wrapped and aligned in one face wherever it is centred, right-aligned or wrapped.

#### Scenario: Lao text renders with real glyphs

- **GIVEN** a company whose `name_th` contains Lao characters
- **WHEN** the PDF is exported
- **THEN** the company name and the Lao labels are rendered with the embedded font, not as
  missing-glyph boxes

#### Scenario: Digits and English print in Times

- **GIVEN** a subject reading `ການນຳໃຊ້ລະບົບ HAL EXPRESS APP` and a document dated 17/08/2026
- **WHEN** the letter is exported
- **THEN** `HAL EXPRESS APP` and `17/08/2026` are drawn in the Times design, and the Lao in
  Phetsarath OT
