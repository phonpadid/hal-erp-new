## 1. Lao font asset

- [x] 1.1 Add a Lao Unicode TTF (Noto Sans Lao, SIL OFL — with its license file) under `back/src/assets/fonts/`
- [x] 1.2 Ensure the font is copied into the backend build output (`dist`) so prod/container runs resolve it (wire into the nest-cli / build asset copy step)

## 2. Extend the PDF model (buildModel)

- [x] 2.1 Add `createdAt: Date | null` to `DocumentPdfModel` and populate it from `document.created_at`
- [x] 2.2 Add `companyLogo: Buffer | null`; fetch bytes from `company.profile_image_path` via `StorageService.getObject`, degrading to `null` on miss (reuse the existing `loadImage` helper)
- [x] 2.3 Add `proposer: { name, position, department }`; resolve from `document.related_employee`, else the `Employee` of `document.created_by` in `document.company` (resolve by explicit `findOne`, not lazy populate). Blank fields when unresolved
- [x] 2.4 Keep `companyName` mapped from `company.name_th`; confirm form-field body (`fieldValues`) already follows `form_field.sort_order`

## 3. Rewrite the renderer (toPdf) into the Lao letter layout

- [x] 3.1 Register the bundled Lao font with pdfkit and set it as the default face before writing text; on missing asset throw a clear configuration error (mirror the lazy `pdfkit` load)
- [x] 3.2 Render the Lao national header block (state name, motto, ‑‑‑000‑‑‑), centred, as constants
- [x] 3.3 Render the company logo top-left (when `companyLogo` present) and `companyName`; render ເລກທີ (`docNo`) and ວັນທີ (`createdAt` as a date) right-aligned
- [x] 3.4 Render the centred title (ໃບສະເໜີ) from `documentTypeName`, the ຮຽນ line, and the proposer line (ຂ້າພະເຈົ້າ ທ້າວ/ນາງ «name», ຕຳແໜ່ງ «position», ສັງກັດ ພະແນກ «department»)
- [x] 3.5 Render the letter body (ເລື່ອງ/details) from `fieldValues`, each labelled by its field label, in order; omit fields without a value
- [x] 3.6 Render the signature footer as columns — one per `signatureBlocks` entry, labelled by `stepName`, embedding `signatureImage` when present, else name+timestamp or placeholder (behaviour unchanged from current spec)
- [x] 3.7 Retain the DRAFT watermark overlay for non-COMPLETED documents

## 4. Tests

- [x] 4.1 Update `document-pdf.spec.ts` for the new model fields: `createdAt`, `companyLogo` present/absent, and `proposer` resolved from `related_employee` and from `created_by`, including blank position / unresolved employee
- [x] 4.2 Assert the body follows `form_field.sort_order` and omits valueless fields
- [x] 4.3 Assert company isolation and DRAFT watermark still hold (no regression); logo/name only from the document's own company
- [x] 4.4 Add a render smoke test: `render(id)` produces non-empty PDF bytes with the Lao font registered (skips gracefully if pdfkit is not installed, matching current tests)

## 5. Verify

- [x] 5.1 Export a document whose company has a Lao `name_th` + logo and confirm the letter matches `reference/pdf/export.pdf` (header, logo, ເລກທີ/ວັນທີ, proposer, body, signature columns) with Lao glyphs rendering correctly
- [x] 5.2 Export a document whose company has no logo and whose employee has no position — confirm it still succeeds
