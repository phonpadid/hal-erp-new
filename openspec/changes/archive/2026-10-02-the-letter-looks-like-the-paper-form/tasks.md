## 1. The letter header

- [x] 1.1 In `DocumentPdfService.toPdf`, draw the logo centred over the company name at the left
  (`fit` 72×72, with `align` / `valign: 'center'`; x from the name's measured width). Advance past
  it only when it was drawn
- [x] 1.2 Draw the number row beneath it:
  - the company name at the left margin, wrapping before the right column;
  - `ເລກທີ {doc_no}` right-aligned at the same height;
  - the date line right-aligned below it.

  Widen the right column so the dated place of issue fits on one line
- [x] 1.3 Add `PLACE_OF_ISSUE = 'ນະຄອນຫຼວງວຽງຈັນ'` beside the other letter boilerplate. The date line
  becomes `ນະຄອນຫຼວງວຽງຈັນ, ວັນທີ DD/MM/YYYY`

## 2. The proposer lines

- [x] 2.1 Delete `PURPOSE_LEAD`. End the second proposer line at the department, with no trailing
  separator

## 3. Tests

- [x] 3.1 In `document-pdf.spec.ts`, wrapping pdfkit's `text` / `image` as the signature test does,
  assert:
  - the logo is centred over the company name;
  - the name is at the left margin at the number's height;
  - the date line reads `ນະຄອນຫຼວງວຽງຈັນ, ວັນທີ …`;
  - no drawn text contains `ມີຈຸດປະສົງ`;
  - a company without a logo still renders, with the name row directly under the national header

## 4. Verification

- [x] 4.1 `DB_PORT=5433 DB_NAME=erp_test pnpm -C back test` is green
- [x] 4.2 Export a real letter locally and compare it against the paper form: logo centred, name
  left, number and dated place right, no ມີຈຸດປະສົງ phrase
