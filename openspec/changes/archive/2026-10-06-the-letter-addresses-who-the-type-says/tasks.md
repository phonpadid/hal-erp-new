## 1. The column

- [x] 1.1 Add `letter_addressee varchar` (nullable) to `document_type` in
      `erp_approval_system.dbml`, with a note beside `print_templates` / `view_permission_code`
      saying what NULL means, that it replaces the whole `ຜູ້ອຳນວຍການ<company>` phrase in both letter
      lines, that an empty string is stored as NULL, and why it is configuration (invariant 7).
- [x] 1.2 Add the property to `DocumentType` in
      `back/src/modules/document/document.entities.ts`, nullable, with the same reasoning in a doc
      comment.
- [x] 1.3 Write the additive migration (one `alter table ... add column`, nullable, no backfill;
      `down` drops it). Name it for the day it is written, following the existing convention.

## 2. Writing the setting

- [x] 2.1 Add `letterAddressee?: string | null` to the create and update type DTOs in
      `back/src/modules/document/dto/config.dto.ts`, validated as an optional string with a
      sensible max length.
- [x] 2.2 Handle it in `document-type.service.ts` create and update: trim, and store an empty or
      whitespace-only value as NULL so "cleared" and "never set" are one state. `undefined` on
      update means "leave alone", as the other optional fields already do.

## 3. Printing it

- [x] 3.1 In `back/src/modules/document/document-pdf.service.ts`, change `RECIPIENT_LINE` and
      `CLOSING_PARAGRAPH` to take the ADDRESSEE rather than the company name, and add one resolver
      that returns the type's `letter_addressee` or, when it is NULL, `ຜູ້ອຳນວຍການ` + the company
      name. Both lines read that one resolver — two fallbacks are how the two lines come to disagree.
- [x] 3.2 Carry the resolved addressee on the render model beside `printTemplates`, so the renderer
      never has to know the default rule, and leave `companyName` exactly as it is — the letterhead
      at the company-name block must not move.

## 4. The admin field

- [x] 4.1 Add the field to `front-end/src/views/admin/doc-config/DocTypeFormView.vue` beside the
      printed-sheets setting, sending `null` rather than `''` when it is left empty.
- [x] 4.2 Add its label and help text to the `la`, `en` and `zh` locales. The help text states what
      an empty field prints, so "not set" is readable without exporting a PDF.

## 5. Tests

- [x] 5.1 In `back/src/modules/document/document-pdf.spec.ts`: a type with NULL prints
      `ຮຽນ: ຜູ້ອຳນວຍການ<company>.` and proposes to the same, exactly as today.
- [x] 5.2 A type with an addressee prints it in the salutation, and `ຜູ້ອຳນວຍການ` appears in neither
      line.
- [x] 5.3 The salutation and the closing name the same party — the test that fails if the two lines
      ever grow separate fallbacks.
- [x] 5.4 A configured addressee leaves the letterhead company name unchanged.
- [x] 5.5 An empty or whitespace-only value is stored as NULL and prints the default wording (service
      test, not a PDF test).
- [x] 5.6 A frontend test that the type form offers the field and sends `null` when it is cleared.

## 6. Verify

- [x] 6.1 Run the document PDF suites and the doc-config frontend suites green.
- [x] 6.2 Run the full backend and frontend suites, and build `shared`, `back` and `front-end`,
      before anything is pushed.
- [x] 6.3 After deploy, the administrator sets `PRFI` → `ພະແນກພັດທະນາເທັກໂນໂລຊີ` in the type form and
      exports one PRFI letter to confirm both lines changed and the letterhead did not. This is
      configuration, not part of the change.
