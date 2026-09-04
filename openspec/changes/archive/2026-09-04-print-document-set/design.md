## Context

`DocumentPdfService` already renders one sheet: the Lao official letter, drawn command-by-command
with pdfkit against a model assembled by `buildModel()` (header, form field values, lines, approval
trail, and per-step signature blocks whose images are fetched from object storage as stamped onto
`approval_log`). That model is the valuable half and stays; the renderer is the half that does not
scale, because the three new sheets are nested tables and pdfkit has no table primitive — every
cell would be hand-placed arithmetic.

Two constraints shape the rest. Deployment is an SSH script onto a VPS, not a container image, so a
dependency that needs a system package (LibreOffice) or a headless browser (Chromium) has to be
provisioned by hand on every host including developers' machines. And attachments are accepted
today with `validateUpload(file, null, …)` at both entry points — document attachments
(`attachment.service.ts`) and payment slips (`payment.service.ts`) — meaning any file type at all,
which is itself a drift from `document-engine`'s existing wording about an allow-list. Narrowing
uploads to PDF/JPEG/PNG is what makes "print every attachment" a tractable problem instead of a
document-conversion project. The live database shows this costs nothing in practice: of 26 stored
files, 25 are already JPEG, PNG or PDF and one is a stray markdown file.

## Goals / Non-Goals

**Goals:**

- Render PR, PO and Receipt sheets server-side, selected by configuration, next to the existing
  letter.
- Print a finished purchase as one PDF: the documents of the reference chain plus the evidence
  attached to each.
- Keep the printed set inside the caller's existing read rights — company scope for documents,
  `PAYMENT_VIEW` for slips.
- Narrow uploads to what can be printed, without retracting access to anything already filed.

**Non-Goals:**

- Converting Word, Excel, or any office format. The upload allow-list removes the need rather
  than solving it.
- A visual template designer, or per-company sheet layouts. The four templates are code; only the
  choice between them is data.
- Storing the exported PDF as an attachment or a rendition. Exports stream; nothing new is
  persisted.
- Changing what a document's letter layout prints today.

## Decisions

### D1 — pdfmake for the sheets, keeping `buildModel()`

The three new sheets are declarative tables, which is what pdfmake is for: a document definition of
nested `{ table: { widths, body } }` objects with column spans and page breaks, rendered by the
pdfkit engine already in the dependency tree, using the same bundled `NotoSansLao-Regular.ttf`
(already copied into `dist` by `nest-cli.json` assets). `buildModel()` is extended, not replaced —
sheets need vendor, payee bank account, line budget and GL, and the predecessor's `doc_no` on top of
what it already assembles — and the renderer splits into one function per template behind a
selector. Keeping the model builder separate from the renderer is what makes the sheet rules
unit-testable without rendering bytes, which is how the existing tests are written.

*Alternatives:* hand-drawn pdfkit (no new dependency, but every table line is arithmetic and every
future edit re-does it); HTML plus headless Chromium (best layout control, but provisioning
Chromium on the deploy host and every developer machine is a real ops cost for one feature);
client-side `window.print()` of an HTML page (fastest to build and matches the reference
screenshots, but the client cannot read another approver's stamped signature — exposing those
images to the browser is a new disclosure surface for the sake of a layout convenience).

### D2 — `document_type.print_template`, not a branch on `code`

A closed set (`LETTER` | `PR` | `PO` | `RECEIPT`) on `document_type`, defaulting to `LETTER`, in
the same shape `post_action` already uses: declared once in `@erp/shared`, read by the DTO validator,
the DB check constraint and the admin form, so the four spellings cannot drift. Deriving the sheet
from `document_type.code` would be per-type logic in code (invariant 7) and would break for a
company that names its purchase request `REQ`, or runs two of them.

### D3 — Render attachments at export time; store no rendition

Nothing is converted at upload and nothing is cached. A PDF is merged page-for-page and a JPEG/PNG
is embedded natively by pdf-lib — both are milliseconds of work, so the earlier idea of an
`attachment_rendition` table, a conversion queue and a backfill buys nothing once office formats
are out of scope. The export stays a pure read: no new table, no background job, no state that can
fall out of sync with the file it describes.

### D4 — pdf-lib as the assembler, over untrusted input

pdfmake produces each sheet's bytes; pdf-lib concatenates sheets, merged attachment pages and image
pages into the streamed result, and stamps the `doc_no` + file name footer on every appended page.
Attachment bytes are user input and are treated as such: `copyPages` output has document-level
JavaScript, open actions, embedded files and annotations stripped before it joins our output, and an
encrypted or unparseable file becomes a placeholder page rather than an exception. Ceilings on pages
per attachment and per export bound the memory this can consume, since everything is buffered.

### D5 — Sniff the bytes, at both entry points

`validateUpload` grows an optional signature check, and both call sites pass the three-type
allow-list instead of `null`. Three magic prefixes cover it: `%PDF`, `\x89PNG\r\n\x1a\n`,
`\xFF\xD8\xFF`. This matters more than usual here because these bytes are no longer only downloaded
on request — they are merged into a document the company prints, signs and files. The declared
content type stays recorded, but stops being what decides acceptance.

### D6 — The chain walk borrows the read predicate, not a new one

`parts=CHAIN` follows `ref_document` upward through the same scoped entity manager the detail read
uses, so an unreadable or cross-company predecessor is simply not found and is omitted from the set
(invariant 1). Direction is deliberately upward-only: a document knows its predecessor, and walking
downward would need a reverse lookup whose visibility rules are a separate question. The walk is
depth-capped so a mis-seeded cycle cannot produce an unbounded PDF.

### D7 — Slips follow `PAYMENT_VIEW`, and are invisible without it

The detail endpoint already draws this line (`hasPayment` says whether evidence exists; reading it
is `PAYMENT_VIEW`'s business). The export honours the same line, and omits slips from the separator
listing as well as from the pages — naming a file the caller may not open would leak what the gate
exists to protect.

### Budget, quota, and transaction boundaries

This change writes nothing. It creates no `budget_txn` or `quota_usage` row, takes no pessimistic
lock, and needs no `em.transactional()` boundary: every path is a read through the active-company
scope, and the only new column is written by document-type configuration, which is not a ledger.
The migration is additive — one nullable-then-defaulted column — and touches no ledger table.

## Risks / Trade-offs

- **A large chain with many attachments buffers a big PDF in memory** → cap pages per attachment
  and per export, and fail the individual attachment (placeholder page) rather than the export.
- **A malicious PDF exploits the merge path** → strip active content on copy, refuse encrypted
  files, and never execute or resolve anything inside an attachment; pdf-lib parses structure only.
- **Narrowing uploads blocks a real workflow** — someone needs to attach a spreadsheet →
  accepted deliberately: the file can still be printed to PDF by its author, and the alternative is
  an office-conversion engine on the deploy host. Existing files stay downloadable, so nothing
  already filed is lost.
- **A `.heic` from an iPhone is refused** → the photo picker on iOS already converts to JPEG; only
  a file chosen through the Files app hits this, and the rejection message names the accepted types.
- **The sheets need data some documents do not carry** (vendor contact, budget code, GL) → every
  sheet cell renders blank rather than failing, so a sparsely-filled document still prints.
- **`print_template` is set wrong and a document prints the wrong sheet** → it is configuration a
  `DOC_CONFIG_MANAGE` user can correct in the admin form, and the default keeps every existing type
  printing what it prints today.
- **Two renderers now draw Lao text** (pdfkit for the letter, pdfmake for the sheets) → accepted
  deliberately: the letter keeps the layout it has always had rather than being re-drawn, so the
  risk of a regression falls only on the new sheets, which nobody has filed yet. Both load the same
  bundled face, so the glyphs cannot diverge.

## Migration Plan

1. Ship the `print_template` column with a `LETTER` default and backfill existing rows to `LETTER`;
   every type keeps printing what it prints today, and `parts` defaults to `SELF`, so the endpoint's
   current behaviour is unchanged for callers that do not opt in.
2. Configure the HAL Logistic purchase types to `PR` / `PO` / `RECEIPT` through the admin form (data,
   not migration — other companies choose their own).
3. Narrow the upload allow-list last, after the print path is live, so a user who is refused a file
   type is refused for a reason that is already visible on screen.
4. Rollback is the reverse: the endpoint ignores `parts`, the column keeps its default, and the
   upload allow-list widens back to what it accepts today. No data is rewritten at any step.

## Open Questions

- Should a `CHAIN` export from the middle of a chain (a PO whose receipt exists) also print the
  successors? Upward-only is what this change specifies; printing downward needs the visibility
  rules for a reverse lookup to be settled first.
- What page ceilings are right in practice — a 50-page attachment and a 200-page export are
  placeholders until someone has printed a real month of documents.
