## Why

A finished purchase runs across three documents — ໃບສະເໜີຈັດຊື້ (PR), ໃບສັ່ງຊື້ (PO) and
ໃບເບີກຈ່າຍ (Receipt) — and the paper that gets filed, signed and handed to an auditor is the
whole set, together with the evidence attached along the way (transfer slips, quotations,
invoices). Today the only export is a single Lao official letter (ໃບສະເໜີ) for one document,
with no way to print the set, no PR/PO/Receipt sheet, and no way to get the attached evidence
onto the same paper — so the set is assembled by hand from three screens plus whatever files
someone downloads out of the attachment list.

## What Changes

- Three new printable sheets — `PR`, `PO`, `RECEIPT` — rendered server-side alongside the
  existing letter, matching the forms the business already uses on paper.
- A new `document_type.print_template` column (`LETTER` | `PR` | `PO` | `RECEIPT`) selects the
  sheet. Which sheet a type prints is configuration, not a branch on `code` (invariant 7):
  another company may spell its purchase-request type differently.
- The export endpoint gains a `parts` argument: `SELF` (this document only, today's behaviour
  and the default) or `CHAIN` (walk `ref_document` up to the root and print PR + PO + Receipt as
  one PDF). Only the documents that actually exist in the chain are printed.
- Attached evidence is appended to the exported PDF automatically: PDFs merged page-for-page,
  images placed one per page, each page stamped with the document number and file name it came
  from, behind a separator page listing the files.
- Payment slips are appended only for a caller holding `PAYMENT_VIEW`. Reading slips is that
  permission's business today; the print button must not become a way around it.
- **BREAKING** Attachment and slip uploads are narrowed to `application/pdf`, `image/jpeg` and
  `image/png`, validated by the file's own magic bytes rather than the browser-declared mime
  type. Any file type is accepted today, which is also a drift from what `document-engine`
  already specifies ("validating the mime type against the image/document allow-list"). Files
  already stored outside the allow-list stay readable and downloadable; they print as a
  placeholder page naming the file.
- The document detail screen's export action becomes a print dialog offering the two choices,
  and the attachment picker offers only the three accepted types.

## Capabilities

### New Capabilities

None — every change extends an existing capability.

### Modified Capabilities

- `document-pdf-export`: adds the PR/PO/Receipt sheet layouts, template selection driven by
  `document_type.print_template`, the `SELF`/`CHAIN` export scope, appended attachment evidence,
  and the `PAYMENT_VIEW` gate on slips.
- `document-engine`: `document_type` gains `print_template`; the attachment allow-list becomes a
  concrete three-type set enforced on sniffed bytes, and pre-existing attachments outside it stay
  readable.
- `web-documents`: the detail screen's print dialog, and the attachment picker's accepted types.
- `web-doc-config`: the document-type admin form edits `print_template`.

## Impact

- **Data model**: `erp_approval_system.dbml` — one new column on `document_type`; migration
  defaults existing rows to `LETTER` so today's output is unchanged.
- **Backend**: `document-pdf.service.ts` (model builder reused, renderer replaced),
  `document.controller.ts` (`parts` query argument), `attachment.service.ts` and
  `payment.service.ts` (both pass `allow: null` today), `common/storage/upload.ts` (magic-byte
  sniffing), document-type DTOs and service.
- **Frontend**: `DocumentDetailView.vue` print dialog, attachment upload picker, document-type
  admin form, i18n in all four locales.
- **Dependencies**: adds `pdfmake` (table-driven sheet layout on the pdfkit engine already
  present, reusing the bundled `NotoSansLao-Regular.ttf`) and `pdf-lib` (merging attachment PDFs,
  embedding images, stamping, and stripping active content out of untrusted PDFs). Both MIT, both
  pure JS — no headless browser and no LibreOffice on the deploy host, which the SSH-based
  pipeline has no way to provision.
- **Invariants**: company isolation is the one at risk — the chain walk and every attachment read
  must stay inside the active-company scope, so a predecessor in another company is simply absent
  from the printed set rather than fetched. `budget_txn`/`approval_log` are untouched: printing
  reads, it never writes. Signature evidence keeps the existing rule that a re-export reproduces
  the sheet it produced before.
