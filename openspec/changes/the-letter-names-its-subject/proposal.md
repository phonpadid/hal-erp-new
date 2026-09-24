## Why

The printed proposal letter (ໃບສະເໜີ) has two visible defects.

1. **The ເລື່ອງ line is always a dotted blank.** The renderer was built with a slot for it
   (`subject: null`, "wire this to a form field when one exists"), but nothing ever fills that
   slot, so no letter can state what it is about.
2. **Signatures sit left of their column.** A stamped signature image is drawn into a box centred
   in its column, but the image is not centred inside that box. A signature narrower than the box,
   such as a tall one, therefore hugs the box's left edge. On the proposer's column this is plain
   to see.

The subject must come from configuration, not from a new column. Administrators already add fields
to forms at `/doc-config/forms`, and the letter already reads ເຫດຜົນ from a form field by its name
(`Reson`). The ເລື່ອງ line should be read the same way.

Adding a second text field exposes a latent ambiguity. The payables sheet picks its description
fallback as "the first text-typed field", which chooses a field by its *type*. Once a form carries
both `subject` and `Reson`, that rule depends on the order the administrator happened to put them
in. The sheet must choose by *name*, as the letter does.

## What Changes

- **ເລື່ອງ from the form.** The letter's subject line prints the value of the form field whose
  `form_field.field_name` is `subject` (case-insensitive; `topic` is accepted as an alias).
  - If no field has either name, it falls back to a field whose `field_label` is ເລື່ອງ.
  - The name always wins over the label.
  - With no such field, or with no value recorded, the line stays the dotted blank it is today.
  - The field used as the subject is not printed a second time in the letter body.
- **Signatures centred.** Each stamped signature image is centred horizontally, and vertically,
  within its column's signature area on the letter. The configured sheets already centre theirs,
  and they are unchanged.
- **Payables description chooses by name.** When no line carries a description, the description
  cell falls back in this order:
  1. the form's purpose/reason field, by the names the letter already uses (`purpose`,
     `purposes`, `reason`, `reson`, `objective`);
  2. only then the first text-typed field that is not the subject, whether the subject was found
     by name or by label.

  The subject is never used as the description.
- **No schema change.** There is no new table, no new column and no migration. Filling the line is
  configuration: an administrator adds a `text` field named `subject`, labelled ເລື່ອງ, to a form.

Not breaking:
- A form without a `subject` field prints exactly as before.
- A form whose only text field is `Reson` gets the same payables description as before.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `document-pdf-export`:
  - **Added:** the subject line is read from the form's `subject` field.
  - **Added:** signature images are centred in their column.
  - **Modified:** the letter body omits the field used as the subject.
- `payables-worksheet-export`:
  - **Modified:** the description fallback chooses the form field by name (purpose/reason first,
    never the subject) instead of by type and order.

Invariants: none is at risk. The change is read-only rendering, with no budget, quota, ledger,
numbering or FX involvement. Invariant 7 (configuration over code) is the reason for the chosen
approach: the line is filled by configuring a form field, not by a hardcoded column.

## Impact

- `back/src/modules/document/document-pdf.service.ts`:
  - add `SUBJECT_FIELD_NAMES`;
  - set `subject` from the form;
  - exclude that field from `fieldValues`;
  - add `align` / `valign: 'center'` on the signature image.
- `back/src/modules/document/document.service.ts`: `payablesWhere` picks the description field
  by name.
- Tests next to both files.
- **Configuration (not code), after deploy:** add a `text` field `subject` / ເລື່ອງ to each form
  that should print a subject.
  - A DRAFT form takes the field directly.
  - A PUBLISHED form needs a new version, because published forms are frozen.
