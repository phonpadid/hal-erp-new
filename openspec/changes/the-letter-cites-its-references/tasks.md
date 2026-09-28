## 1. Field conventions

- [x] 1.1 `REFERENCE_FIELD_NAMES`, `REFERENCE_FIELD_LABELS`, `findReferenceField` and `referenceLines`
  in `form-field-names.ts`, with unit tests

## 2. The letter

- [x] 2.1 `references` on `DocumentPdfModel`, from the ref field, one entry per line
- [x] 2.2 Skip the ref field in the body
- [x] 2.3 Draw the block under ເລື່ອງ: a dash per entry, the text hanging in its own column
- [x] 2.4 Tests: model (listed, kept out of the body, empty without a field or value) and drawing

## 3. Payables

- [x] 3.1 The description fallback skips the ref field; test

## 4. Numbers, dashes and the font

- [x] 4.1 `stripHtml` numbers `<ol>` items; a numbered ref entry keeps its number
- [x] 4.2 The rich editor keeps a typed `- ` as a dash (`front-end/src/utils/formFields.ts`)
- [x] 4.3 HAL Letter font merged from Phetsarath OT + Tinos; `LAO_FONT_FILE` points at it

## 5. After deploy (configuration)

- [ ] 5.1 Add a `text` field `ref` / ອີງຕາມ to the notice form at `/doc-config/forms`
