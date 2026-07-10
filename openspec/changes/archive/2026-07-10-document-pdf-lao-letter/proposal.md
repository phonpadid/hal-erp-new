## Why

The current document PDF export renders an intentionally minimal, English-labelled
layout. Lao operating companies need the export to look like their real official
letter (ໃບສະເໜີ): a Lao national header, the issuing company's logo and name, ເລກທີ
(document number) and ວັນທີ (date), a proposer identity line drawn from the creating
employee, the configured form fields as the letter body, and a Lao-labelled signature
footer. The existing renderer also cannot display Lao (or Thai) script at all, because
pdfkit's built-in fonts have no Lao glyphs — so today a Lao company name renders as tofu.

## What Changes

- Replace the minimal export layout with a **Lao official-letter layout** as the default
  for every document export. The document header, form field values, approval trail,
  watermark, and per-step signature blocks are all retained; only the visual template and
  the sources feeding the header/body change.
- Render a fixed **Lao national header block** (ສາທາລະນະລັດ ປະຊາທິປະໄຕ ປະຊາຊົນລາວ / ສັນຕິພາບ
  ເອກະລາດ… / ‑‑‑000‑‑‑) at the top of every exported document.
- Draw the **issuing company's logo** (from the document's company `profile_image_path`,
  fetched server-side from object storage) and **company name** (`company.name_th`, which
  holds the Lao name in this deployment) below the national header.
- Show **ເລກທີ** from the document number (`doc_no`) and **ວັນທີ** from the document's
  `created_at`, formatted as a date.
- Render the **proposer line** — ຂ້າພະເຈົ້າ ທ້າວ/ນາງ «full name», ຕຳແໜ່ງ «position»,
  ສັງກັດ ພະແນກ «department» — resolved from the document's related/creating employee.
- Render the **letter body** from the form fields configured for the document's
  `form_template` (the same fields configured at `/doc-config/forms`), in template order.
- Keep the **signature footer driven by workflow-step configuration**: one signature
  column per step flagged `show_signature_on_pdf`, labelled by `step_name`, embedding the
  stamped approver signature — unchanged from the existing capability, only restyled into
  the letter's columnar footer.
- **Embed a Lao Unicode font** (e.g. Noto Sans Lao / Phetsarath OT) so Lao and Thai text
  render correctly; register it with the renderer as the default face.
- The contact/address footer shown on the paper reference is intentionally **out of scope**
  (the `company` table has no address fields); it is omitted.

## Capabilities

### New Capabilities
<!-- None — this refines an existing capability. -->

### Modified Capabilities
- `document-pdf-export`: The exported PDF's layout and the header/body data sources change.
  New requirements cover the Lao national header, the company logo + Lao name header, the
  ເລກທີ/ວັນທີ fields, the employee-sourced proposer line, the form-config-driven letter
  body, and Lao-script font embedding. The existing requirements (read authorization &
  company isolation, DRAFT watermark, configurable per-step signature blocks, stamped
  approver signatures) are preserved; the signature-block requirement is only restyled, not
  behaviourally changed.

## Impact

- **Spec**: `openspec/specs/document-pdf-export/spec.md` (delta).
- **Backend**: `back/src/modules/document/document-pdf.service.ts` — extend
  `DocumentPdfModel` with `createdAt`, company logo bytes, and a `proposer`
  `{ name, position, department }`; rewrite `toPdf()` for the letter layout; register the
  embedded Lao font. `document-pdf.spec.ts` updated for the new model fields.
- **Assets**: add a Lao Unicode TTF (Noto Sans Lao / Phetsarath OT) bundled with the
  backend and loaded by the renderer.
- **Data sources** (read-only, no schema change): `company.profile_image_path`,
  `company.name_th`, `document.created_at`, and the creating/related `employee`
  (`full_name`, `position`, `department`).
- **Invariants**: read authorization and active-company scope are unchanged — export still
  resolves the document within the active-company scope, so company isolation (invariant 1)
  holds; no ledger or budget behaviour is touched. Logo/name come only from the document's
  own company, so no cross-company data leaks.
