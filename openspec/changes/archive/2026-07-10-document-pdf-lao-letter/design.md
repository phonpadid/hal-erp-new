## Context

`DocumentPdfService` (`back/src/modules/document/document-pdf.service.ts`) already splits a
renderer-agnostic model builder (`buildModel`) from a minimal pdfkit renderer (`toPdf`). The
builder resolves the document within the active-company scope, gathers form field values in
template order, the approval trail, and per-step signature blocks (driven by
`workflow_step.show_signature_on_pdf`), and fetches stamped signature images from storage.
The renderer emits a bare English layout.

Two facts constrain this change:

1. pdfkit's built-in fonts (Helvetica family) contain no Lao/Thai glyphs, so any Lao text —
   including today's `company.name_th` — renders as missing-glyph boxes. A Lao Unicode font
   must be embedded before the letter layout is meaningful.
2. The `company` table has no address/contact fields and no separate Lao-name column; in
   this deployment `name_th` already carries the Lao company name. Per product decision the
   paper letter's contact/address footer is dropped, and no company columns are added.

## Goals / Non-Goals

**Goals:**
- Render every document export in the Lao official-letter layout matching
  `reference/pdf/export.pdf`: national header, company logo + name, ເລກທີ/ວັນທີ, ໃບສະເໜີ
  title, proposer line, configured form body, and a workflow-driven signature footer.
- Source header/body strictly from existing data: `company.profile_image_path`,
  `company.name_th`, `document.doc_no`, `document.created_at`, the document's employee, and
  the `form_template` field values.
- Embed a Lao Unicode font so Lao/Thai renders correctly.
- Preserve the existing capability's behaviour: read-auth + company isolation, DRAFT
  watermark, per-step signature blocks with stamped signatures.

**Non-Goals:**
- No company address/contact footer; no new `company` columns.
- No per-document-type template selection — the letter layout is the single default.
- No change to routing, approval, budget, quota, or the signature-stamping rules.
- No frontend change: the existing export trigger/endpoint is reused.

## Decisions

### D1 — One default layout, not a configurable template
The layout is applied to all exports (product decision). Alternatives considered: a
`document_type.pdf_layout` flag (rejected for now — adds config surface and a migration for
a single needed layout; can be introduced later without breaking this work). The renderer
stays a pure function of `DocumentPdfModel`, so a future per-type switch is a renderer
branch, not a rewrite.

### D2 — Extend `DocumentPdfModel`, keep builder/renderer split
Add to the model: `createdAt: Date | null`; `companyLogo: Buffer | null` (bytes, fetched
like signature images via `StorageService.getObject`, degrading to `null` on miss);
`proposer: { name: string | null; position: string | null; department: string | null }`.
`companyName` continues to map from `company.name_th`. This keeps rules unit-testable
without rendering bytes, consistent with the existing design.

### D3 — Resolve the proposer from the document's employee
Prefer `document.related_employee`; when absent, look up the `Employee` for
`document.created_by` in `document.company` (the same `Employee { user, company }` lookup
already used to name approvers). Take `full_name`, `position`, and `department.name`. Missing
fields render blank; an unresolved employee leaves the whole line blank — the export never
fails on it. Resolve by id / explicit `findOne` rather than lazy populate, per the repo's
"populate can return an unloaded stub" convention (see `documenttype-populate-unloaded-ref`).

### D4 — Embed a Lao Unicode font bundled with the backend
Bundle a permissively-licensed Lao TTF — Noto Sans Lao (SIL OFL) or Phetsarath OT — under
the backend (e.g. `back/src/assets/fonts/`), copied into `dist` at build. The renderer
registers it with `doc.registerFont('lao', <path>)` and sets it as the default face before
writing any text; the "DRAFT" watermark and Latin text also render acceptably with a font
that carries Latin glyphs (Noto Sans Lao covers basic Latin). Alternatives: system-font
lookup (rejected — not reproducible across environments/containers); switching to an
HTML→PDF engine like puppeteer (rejected — heavyweight new dependency; pdfkit already wired
and optional-loaded). Font file resolution mirrors the existing lazy `pdfkit` load so a
missing asset yields a clear configuration error, not a silent tofu render.

### D5 — Letter layout composition
Render order in `toPdf`: (1) national header block (constants), (2) logo top-left + company
name, with ເລກທີ/ວັນທີ right-aligned, (3) centred ໃບສະເໜີ title (from
`documentTypeName`), (4) ຮຽນ line + proposer line, (5) ເລື່ອງ/body from `fieldValues`,
(6) closing line, (7) signature footer as columns — one per `signatureBlocks` entry,
labelled by `stepName`, embedding `signatureImage` when present, else name+timestamp or a
placeholder. The DRAFT watermark overlay is retained for non-COMPLETED documents.

## Risks / Trade-offs

- [Font licensing/size] → Use an SIL OFL font (Noto Sans Lao / Phetsarath) that permits
  bundling and redistribution; a single weight (~hundreds of KB) keeps the image lean.
- [Latin/number glyphs in a Lao font] → Choose a face that includes Basic Latin + digits
  (Noto Sans Lao does) so `doc_no`, dates, and the watermark render; otherwise fall back to
  Helvetica only for the watermark.
- [Fixed strings only in Lao] → National header, ໃບສະເໜີ, and field labels are Lao
  constants; if a non-Lao company ever exports, its Latin `name_th` still renders (the font
  covers Latin). Localisation of these constants is out of scope here.
- [Employee lookup cost] → One extra `Employee` `findOne` per export; negligible and
  batched-by-id consistent with the existing approver lookup.
- [Reference footer omitted] → The exported letter will not carry the address/contact strip
  from the paper reference; acceptable per product decision, revisitable when the `company`
  table gains contact fields.

## Migration Plan

- No database migration. Additive backend change plus a bundled font asset.
- Ensure the font file is copied into the backend build output (`dist`) so container/prod
  runs resolve it; wire it into the existing asset/copy step.
- Rollback: revert the service and remove the font asset; the endpoint and model contract
  return to the prior minimal layout with no data cleanup.

## Open Questions

- Which exact face to bundle — Noto Sans Lao vs Phetsarath OT? Default to Noto Sans Lao (SIL
  OFL, wide coverage) unless the business prefers Phetsarath for official documents.
- Should the ໃບສະເໜີ title always read "ໃບສະເໜີ", or track `document_type.name`? Default to
  `document_type.name`, so other letter types show their own title.
