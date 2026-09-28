## Why

A Lao notice (ແຈ້ງການ) states what it rests on before it says anything: under ເລື່ອງ, a dashed list
of ອີງຕາມ lines naming the decision and the earlier documents it follows from. The letter has no
place for them. Typed into an ordinary field they print as one body row, label and value side by
side, not as the list the paper form carries. Each reference is often a long sentence, and there can
be several.

## What Changes

- **ອີງຕາມ from the form.** The letter prints, directly under the ເລື່ອງ line, the value of the form
  field named `ref` (case-insensitive; `refs`, `reference`, `references` accepted), else the field
  captioned ອີງຕາມ — the same name-then-caption rule as the subject, never by type.
  - One entry per line the requester wrote (or per list item in the rich editor). A numbered
    entry keeps its number (`1.`, `2.`); any other is drawn behind a dash, and a dash or bullet the
    requester typed is not doubled. A wrapped line hangs under its text.
  - A form without the field, or with it left blank, prints no block.
  - The field is not printed a second time in the body.
- **Numbered lists keep their numbers** everywhere a rich-text value is reduced to text (letter
  body, sheets, spreadsheets): `stripHtml` writes `1.`, `2.` for `<ol>` items instead of `•`.
- **The editor keeps a typed `-`.** Quill turned `- ` at the start of a line into a `•` list;
  `1.`, `*` and `[ ]` still start lists.
- **Digits and English in Times.** Every PDF is set in HAL Letter, one font merged from Phetsarath
  OT (Lao) and Tinos (digits and Latin, a redistributable Times New Roman match), built by
  `back/scripts/fonts/build-letter-font.py`.
- **Payables description.** The ref field is never the description fallback, as the subject is not.
- **No schema change.** An administrator adds a `text` field named `ref` to the form at
  `/doc-config/forms`.

## Capabilities

### Modified Capabilities

- `document-pdf-export`: added the references block; the body omits the ref field; the font
  requirement now covers digits and Latin in Times.
- `payables-worksheet-export`: the description fallback skips the ref field.

Invariants: none at risk — read-only rendering. Invariant 7 is why this is a named form field
rather than a column.

## Impact

- `back/src/modules/document/form-field-names.ts`: `REFERENCE_FIELD_NAMES`, `findReferenceField`,
  `referenceLines`.
- `document-pdf.service.ts`: `references` on the model; drawn under ເລື່ອງ; skipped in the body.
- `document.service.ts`: payables fallback skips it.
- Configuration after deploy: add the `ref` field to each form that should print it (a PUBLISHED
  form needs a new version).
