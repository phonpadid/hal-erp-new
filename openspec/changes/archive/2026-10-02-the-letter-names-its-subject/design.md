## Context

`DocumentPdfService` builds a model for the letter, then draws it with pdfkit.
- `fromForm(names)` reads a form value by `field_name`, lower-cased. ຈຸດປະສົງ/ເຫດຜົນ already
  comes through it via `PURPOSE_FIELD_NAMES`.
- `subject` is hardwired to `null`, with a comment waiting for exactly this change.
- `fieldValues`, the letter body, lists every field with a value.
- Signatures are drawn with `doc.image(img, x + (colW - imgW) / 2, sigY, { fit: [imgW, 48] })`.
  pdfkit's `fit` scales the image into the `imgW × 48` box, but without `align` / `valign` it
  anchors the scaled image at the box's top-left. Any image whose aspect ratio differs from the
  box's is therefore pushed left.

The configured sheets (`document-sheet.renderer.ts`) use a layout engine with `alignment: 'center'`
and are already correct.

`DocumentService.payablesWhere` (payables sheet) takes the description fallback from
`DocFieldValue` rows whose `formField.fieldType` is `text`, keeping the lowest `sortOrder`. That
is a choice by type and position.

## Goals / Non-Goals

**Goals:**
- Print a configured subject.
- Centre signatures on the letter.
- Make the payables description independent of field order.

**Non-Goals:**
- A `document.subject` column, or any schema change.
- Tooling to add the field to published forms (cloning a form version). That is configuration
  work, and a separate change if wanted.
- Trimming transparent margins inside uploaded signature images. If a signature still looks off
  after this change, the cause is the file's own whitespace, and that is a follow-up.
- Changing the configured sheets.

## Decisions

### 1. The subject is found by `field_name`, like ເຫດຜົນ

`SUBJECT_FIELD_NAMES = ['subject', 'topic']` goes beside `PURPOSE_FIELD_NAMES`. The model's `subject`
becomes the value of the field `findSubjectField` returns, stripped of HTML, with an empty value
treated as absent, which is exactly the spec's blank-line rule.
- Name first: names are fixed, while labels are per-company and editable. Never by type: `Reson`
  is also `text`.
- **Label fallback (requested by the user, for robustness):** when no field bears a subject name,
  a field whose `field_label`, after trimming whitespace and a trailing `:`, equals `ເລື່ອງ` is
  used.
  - This catches forms configured with another name but captioned ເລື່ອງ.
  - Because the name takes precedence, a correctly named field is never displaced by a caption.
  - `SUBJECT_FIELD_LABELS = ['ເລື່ອງ']` lives beside the names.
  - One function, `findSubjectField(fields)`, does the lookup, and both the letter and the sheet
    call it.

### 2. The body skips exactly the field that was used as the subject

When a subject was resolved, the id of the field that supplied it is excluded from `fieldValues`.
Only that one field is excluded, not every field with a subject-like name, so a form carrying both
`subject` and `topic` prints the second in the body rather than losing it. `findSubjectField`
returns the field itself, so its id is at hand.

### 3. Centre with pdfkit's own `align` / `valign`

The image call becomes `{ fit: [imgW, 48], align: 'center', valign: 'center' }`. The box itself is
already centred in the column, so centring within the box centres the image on the column axis,
the same axis the heading, baseline, name and date use.

**Testing:** there is no pixel diff. The test spies on the pdfkit document's `image` and asserts
the options passed, plus the box's `x` centring, which is the behaviour that regressed.

### 4. The payables description chooses by name first

In `payablesWhere`, load the document's field values with their `formField` (text-typed ones, as
now, plus the purpose names regardless of type), then per document:
1. the first `PURPOSE_FIELD_NAMES` match with a non-empty stripped value;
2. otherwise the lowest-`sortOrder` text field that is not the field `findSubjectField` returns.

`PURPOSE_FIELD_NAMES`, `SUBJECT_FIELD_NAMES`, `SUBJECT_FIELD_LABELS` and `findSubjectField` move to
one shared module (`document/form-field-names.ts`), so the letter and the sheet cannot drift apart.
The sheet excludes whatever `findSubjectField` returns, whether it was found by name or by label. This stays
batch `$in` reads, with no query per row.

## Risks / Trade-offs

- **[Risk] Published forms cannot take the field without a new version.**
  → This is a documented configuration step (tasks, section 4). Until a form carries the field,
  its letter prints the same blank as today, so nothing regresses.
- **[Trade-off] Two aliases (`topic`) widen the convention slightly.**
  → It costs one list entry, and forms created by other teams need not be renamed.
- **[Risk] A form that named its reason field something unlisted** (e.g. `detail`) keeps today's
  first-text-field behaviour.
  → This is intended; it is the old fallback, narrowed only to skip the subject.

There are no `budget_txn` or `quota_usage` writes, no locks and no transactions. Every path is a
read.

## Migration Plan

No migration. Deploy the code, then configure: add a `text` field `subject` labelled ເລື່ອງ to the
forms that should print a subject. Rollback is a code revert. The configured field would then
simply print in the letter body again.

## Open Questions

_None._
