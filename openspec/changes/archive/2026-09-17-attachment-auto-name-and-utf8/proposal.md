## Why

A file attached to a document in Lao comes back unreadable. `document_attachment.file_name` on the
production copy holds rows like `à»àºàºªàº°à»à»àºµ àº¥àº»àºàº®à»àº§àº¡…(àºªàº±àºàºàº²àºàº­àº).pdf` — that is
"ໃບສະເໜີ ລົດຮ່ວມ… (ສັນຍາ…).pdf" with every byte of UTF-8 read as latin1. The cause is one missing
option: the multipart parser (multer 2 / busboy) decodes filenames as latin1 unless told
`defParamCharset: 'utf8'`, and none of the seven upload endpoints tells it. The same garbled name is
then printed as the caption of the evidence page in the exported PDF and used to build the storage
key, where every Lao letter collapses to `_`.

Even a correctly decoded Lao filename is long and says nothing about which document it belongs to
once downloaded. The person maintaining the item registry asked for the system to name attachments
itself, the way it already numbers documents.

## What Changes

- **Server-generated attachment names.** A file uploaded to `POST /documents/:id/attachments/upload`
  is recorded with `file_name` = `<doc_no>-<nn><ext>` — the document's number, a two-digit
  per-document sequence in upload order, and the extension implied by the validated content type
  (`.pdf`, `.jpg`, `.png`). `RECBL-HAL-2026-0029-01.pdf`, `-02.jpg`. The name is what the attachment
  list shows, what the download is called, and what the PDF evidence page prints.
- **The original name is kept.** New nullable column `document_attachment.original_file_name`
  stores what the uploader called the file (correctly decoded); the web attachment list shows it as
  secondary text under the generated name. Nothing the user typed is thrown away.
- **UTF-8 filenames everywhere.** Every `FileInterceptor` (document attachments, payment slips,
  batch result files, signature, user and company profile images) gets `defParamCharset: 'utf8'`
  through one shared helper, so `originalname` arrives as the uploader wrote it. Storage keys keep
  their ASCII-only sanitising — the key is not a display name.
- **Repair of existing garbled names.** A data migration re-decodes `document_attachment.file_name`
  and `payment_attachment.file_name` from latin1 to UTF-8 **only** where the stored text is a
  latin1 rendering of valid UTF-8 (every byte in the C0–FF range and the result round-trips) — a
  name that already reads correctly is not touched, and the repair is idempotent. Existing
  attachments are NOT renamed to the generated pattern: they keep the (repaired) name they were
  filed under.
- Storage keys of already-stored files are unchanged (renaming objects buys nothing and risks a
  dangling `file_path`).

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `document-engine`: *Attachments on External Storage* gains the generated `file_name`, the
  `original_file_name` column, and the UTF-8 filename requirement for every multipart upload.
- `web-documents`: the attachment list shows the generated name with the original as secondary
  text.
- `document-pdf-export`: the evidence page caption is the stored `file_name`, i.e. the generated
  name for new attachments (behaviour unchanged, wording made explicit).
- `payment-slip`: slip filenames are decoded as UTF-8; existing garbled slip names are repaired by
  the same migration. Slips keep the uploader's name (no generated pattern) — a slip is named by the
  bank, not by us.

## Impact

**Capabilities touched:** document-engine, payment-handoff/payment-slip (filename decoding only),
the PDF export and web layers. No budget, quota, approval or ledger code.

**Invariants:** none at risk. `document_attachment` and `payment_attachment` are metadata tables, not
ledgers — the repair UPDATE is within the rules. Company isolation is untouched: the sequence is
computed inside the document already resolved in the active company. Invariant 7: the extension
comes from the validated MIME type the allow-list already decides on, not from the browser.

**Schema:** one nullable column `document_attachment.original_file_name varchar` (DBML + migration),
plus the data-repair migration.

**Code:** `back/src/common/storage/upload.ts` (shared multipart options), the seven
`@UseInterceptors(FileInterceptor(...))` sites, `attachment.service.ts` (naming + sequence),
`document.entities.ts`, `AttachmentUploader.vue` + `api/documents.ts` (original name),
i18n en/la/zh.

**Concurrency:** two uploads to the same document at once could compute the same `nn`. The
sequence is derived under the document row lock (`SELECT … FOR UPDATE` on `document`) inside one
transaction, and a concurrency test proves two parallel uploads get `-01` and `-02`.

**Rollout:** additive column, idempotent repair; no user-facing announcement needed — names simply
read correctly from the next deploy, and new attachments carry document numbers.
