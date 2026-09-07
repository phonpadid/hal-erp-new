## 1. Data model and shared declarations

- [x] 1.1 Add `print_template` to `document_type` in `erp_approval_system.dbml` (closed set
      `LETTER` / `PR` / `PO` / `RECEIPT`, default `LETTER`, with a note that it selects the printed
      sheet only and never routing)
- [x] 1.2 Declare `PRINT_TEMPLATES` and its `PrintTemplate` type in `shared/src/index.ts` next to
      `POST_ACTIONS`, and add the field to the document-type Zod schema there
- [x] 1.3 Add `printTemplate` to the `DocumentType` entity with a default of `LETTER`
- [x] 1.4 Write the MikroORM migration: add the column with a `LETTER` default, a CHECK constraint
      over the closed set, and a backfill of existing rows
- [x] 1.5 Accept `printTemplate` on the document-type create/update DTOs (`@IsIn` over the shared
      set) and persist it in `document-type.service.ts`
- [x] 1.6 Unit-test that a value outside the set is rejected and that an existing type reads back
      as `LETTER`

## 2. PDF model

- [x] 2.1 Extend `DocumentPdfModel` in `document-pdf.service.ts` with what the new sheets need:
      vendor name/contact, approved payee bank account, per-line budget name + code + GL account,
      per-line unit and remark, tax and subtotal, requester position/department, expected date, and
      the predecessor's `doc_no`
- [x] 2.2 Extend `buildModel()` to resolve those fields inside the active-company scope, leaving
      each one null when the document does not carry it
- [x] 2.3 Unit-test the model builder for a document missing every optional field (nulls, no throw)

## 3. Sheet rendering

- [x] 3.1 Add `pdfmake` and `pdf-lib` to `back/package.json` and confirm pdfmake resolves the
      bundled `NotoSansLao-Regular.ttf` in both a `src` and a `dist` run
- [x] 3.2 Keep the letter on its existing pdfkit layout and route to it from the selector, rather
      than porting it to pdfmake (decided during apply: the letter is a layout people have already
      printed and signed, and re-drawing it risks a visual regression for no user-visible gain —
      the two renderers share the model, the font and the assembler)
- [x] 3.3 Build the shared sheet chrome: bilingual title block, the staff/position/department and
      date/doc-no header grid, the line table, the totals block, and the signature row
- [x] 3.4 Render the `PR` sheet
- [x] 3.5 Render the `PO` sheet (supplier block, bank info, budget topic + code, subtotal/VAT/total)
- [x] 3.6 Render the `RECEIPT` sheet (budget topic + code, GL account, payee account, per-line
      remark column, predecessor PO number)
- [x] 3.7 Select the renderer from `document_type.print_template`, falling back to `LETTER`, with no
      branch on `code`, `category` or `post_action`
- [x] 3.8 Unit-test sheet selection per template value, amount formatting against the currency's
      `decimal_places`, and blank cells for absent optional data

## 4. Attachment evidence

- [x] 4.1 Add the assembler: concatenate rendered sheets and appended pages with pdf-lib, stamping
      each appended page with the owning `doc_no`, the file name, and its page position
- [x] 4.2 Merge `application/pdf` attachments page-for-page, stripping document-level JavaScript,
      open actions, embedded files and annotations from the copied pages
- [x] 4.3 Place `image/jpeg` and `image/png` attachments one per page, scaled to fit without
      distortion
- [x] 4.4 Render the placeholder page for an unprintable, unparseable, encrypted, or over-ceiling
      file, naming the file and the reason, without failing the export
- [x] 4.5 Render the separator page listing each document's files (name, size, uploader, uploaded
      at, owning `doc_no`)
- [x] 4.6 Apply the per-attachment and per-export page ceilings
- [x] 4.7 Append `payment_attachment` evidence only for a caller holding `PAYMENT_VIEW`, omitting it
      from the separator listing as well as the pages otherwise
- [x] 4.8 Unit-test: a corrupt attachment yields a placeholder and the export still succeeds; active
      content does not survive the merge; a caller without `PAYMENT_VIEW` gets no slip and no slip
      file name anywhere in the output

## 5. Chain export and endpoint

- [x] 5.1 Walk `ref_document` upward through the scoped entity manager, predecessor-first, omitting
      anything the caller cannot read, with a depth cap against cycles
- [x] 5.2 Accept `parts` (`SELF` | `CHAIN`, defaulting to `SELF`) on `GET /documents/:id/pdf` as a
      validated query argument, keeping the existing `DOC_VIEW` guard and `assertVisible` call
- [x] 5.3 Name the streamed file after the document number and the selected scope
- [x] 5.4 Test: a three-document chain prints predecessor-first; a chain with a missing middle
      document prints what exists; a cross-company predecessor is absent and discloses nothing; no
      `parts` argument reproduces today's single-document output

## 6. Upload allow-list

- [x] 6.1 Add the magic-byte signature check to `common/storage/upload.ts` (`%PDF`, PNG, JPEG) and
      make `validateUpload` enforce the allow-list against the bytes, not the declared mime type
- [x] 6.2 Pass the three-type allow-list at `attachment.service.ts` (currently `null`)
- [x] 6.3 Pass the same allow-list at `payment.service.ts` for slips (currently `null`)
- [x] 6.4 Test: a rejected type writes no object and no row; a spreadsheet declared as
      `application/pdf` is rejected on its bytes; an already-stored file outside the allow-list is
      still listed and still gets a presigned URL

## 7. Frontend

- [x] 7.1 Replace the export button's direct call with a print dialog on `DocumentDetailView.vue`:
      two radio choices (this document / PR + PO + Receipt), this document preselected, confirm and
      cancel, progress while exporting, message on failure
- [x] 7.2 Send `parts` from the dialog through `documentsApi.exportPdf` and download the returned
      blob
- [x] 7.3 Narrow the attachment picker to PDF/JPEG/PNG with a message naming the accepted types,
      mirroring the server rule in the form's Zod schema
- [x] 7.4 Add the `printTemplate` select to the document-type admin form, labelled as affecting
      printing only, defaulting to the official letter
- [x] 7.5 Add the i18n keys for the dialog, the picker message and the admin field in `en`, `la`
      and `zh`
- [x] 7.6 Component tests: cancel requests nothing; each choice requests its `parts` value; a failed
      export shows a message and downloads nothing; the action stays hidden without permission

## 8. Verification

- [x] 8.1 Run the backend and frontend suites; confirm the existing letter-export tests still pass
      through the new render path
- [x] 8.2 Export a real completed chain from the local database and check the printed set by eye
      against the PR/PO/Receipt reference sheets, including a JPEG slip and a multi-page PDF
- [x] 8.3 Update `openspec/specs/` deltas into the source specs at archive time (via
      `/opsx:archive`), not by hand
