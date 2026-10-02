## 1. Shared field-name conventions

- [x] 1.1 Move `PURPOSE_FIELD_NAMES` out of `document-pdf.service.ts` into a new
  `back/src/modules/document/form-field-names.ts`, keeping its comment on why `reson` is listed.
  Add these there:
  - `SUBJECT_FIELD_NAMES = ['subject', 'topic']` and `SUBJECT_FIELD_LABELS = ['ເລື່ອງ']`;
  - `findSubjectField(fields)`: name first (case-insensitive), then label (trimmed, with a trailing
    `:` removed), never type.
- [x] 1.2 Unit tests for `findSubjectField`:
  - it finds by name;
  - `Subject` in any case matches;
  - `topic` matches;
  - the label `ເລື່ອງ:` matches when no name matches;
  - the name wins over the label;
  - it returns nothing when neither matches

## 2. The letter

- [x] 2.1 In `DocumentPdfService`:
  - set the model's `subject` from the value of `findSubjectField(fields)`, stripped of HTML;
  - replace the `subject: null` comment
- [x] 2.2 Exclude the field that supplied the subject from `fieldValues`, so it does not print in
  the body
- [x] 2.3 Centre the signature image: add `align: 'center', valign: 'center'` to the `doc.image`
  fit options
- [x] 2.4 Tests (`document-pdf.spec.ts` or a new sibling), one per scenario in
  `specs/document-pdf-export/spec.md`:
  - a `subject` value prints on the ເລື່ອງ line;
  - `Subject` in any case matches;
  - a field labelled ເລື່ອງ fills the line when none is named subject;
  - the name wins over the label;
  - with no field, or an empty / markup-only value, the line is the dotted blank;
  - with `subject` sorted before `Reson`, each value is in its own place, and the subject is not
    repeated in the body;
  - the signature `image` call is passed centred fit options, and a box centred in its column

## 3. The payables sheet

- [x] 3.1 In `DocumentService.payablesWhere`, choose the description fallback by name:
  1. the first `PURPOSE_FIELD_NAMES` match with a value;
  2. else the lowest-`sortOrder` text field that is not `findSubjectField`'s result.

  Keep it to batch reads
- [x] 3.2 Tests (`payables-export.spec.ts`):
  - the reason is used when the subject comes first;
  - the subject alone gives an empty cell, whether it was found by name or by label;
  - a lone `note` text field still serves;
  - the existing letter-style scenario is unchanged

## 4. Verification and configuration

- [x] 4.1 `DB_PORT=5433 DB_NAME=erp_test pnpm -C back test` is green
- [x] 4.2 In the browser, against the local stack:
  - add a `text` field `subject` / ເລື່ອງ to a DRAFT form, then publish it;
  - raise a document with a subject;
  - export its letter, and check that the ເລື່ອງ line is filled and the signatures are centred;
  - export the payables sheet, and check that the description is still the ເຫດຜົນ
