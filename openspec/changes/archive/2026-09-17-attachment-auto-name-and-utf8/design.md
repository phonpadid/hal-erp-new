## Context

Seven endpoints take a multipart `file` through Nest's `FileInterceptor` with
`{ limits: uploadLimits(cap) }` from `back/src/common/storage/upload.ts`. multer 2.1.1 forwards an
`options.defParamCharset` to busboy (`lib/make-middleware.js:27,131`); nobody sets it, busboy
defaults to latin1, and every non-ASCII filename is stored garbled. `document_attachment.file_name`
on the production copy shows it: `à»àºàºªàº°à»à»àºµ …pdf`. `StorageService.buildKey` then replaces every
non-`\w` character with `_`, so the object key is `documents/<id>/<ts>-____.pdf`.

`AttachmentService.upload` records `fileName: file.originalname`. The web list
(`AttachmentUploader.vue`) and the PDF evidence page (`document-pdf.service.ts` `fileName: r.fileName`)
both print that column. Documents get their `doc_no` at draft creation (`NumberingService.next`
under lock), so a number is always available when a file is attached.

## Goals / Non-Goals

**Goals:**
- New document attachments are named `<doc_no>-<nn><ext>` by the server; the uploader's name is
  kept alongside.
- Every upload decodes filenames as UTF-8; existing garbled names are repaired where that can be
  done without guessing.
- No change to storage keys, download URLs, or the allow-list.

**Non-Goals:**
- Renaming attachments filed before this change to the generated pattern.
- Renaming or moving stored objects.
- Generated names for payment slips or batch result files (a slip keeps the bank's/phone's name).
- Letting the user pick or edit an attachment's name.

## Decisions

### 1. One shared `multipartOptions(capKb)` instead of seven hand-written option objects
`upload.ts` gains `multipartOptions(maxSizeKb)` returning `{ limits: uploadLimits(maxSizeKb),
defParamCharset: 'utf8' }` and all seven `FileInterceptor` sites use it. Nest's `MulterOptions`
type does not declare `defParamCharset`; the helper's return type carries it explicitly and is
cast once, in one place, with the multer source line cited. *Alternative:* re-decoding
`originalname` from latin1 in each service — rejected; it is a guess applied after the damage,
and it double-decodes a name that arrived correctly.

### 2. Name = `<doc_no>-<nn><ext>`, extension from the sniffed type
`AttachmentService.upload` computes the name inside `em.transactional` after locking the
`document` row (`LockMode.PESSIMISTIC_WRITE`), counting existing `document_attachment` rows for the
document and adding one. The lock is what makes two simultaneous uploads take `01` and `02`
rather than both `01` — the same tool document numbering uses. The extension is mapped from the
MIME type `validateUpload` already checked against the file's leading bytes
(`application/pdf→.pdf`, `image/jpeg→.jpg`, `image/png→.png`), never from the browser's filename.
Two digits: no document in the data carries more than a handful of attachments; a hundredth file
would simply print three digits (`String(n).padStart(2,'0')` does not truncate).
*Alternative considered:* sequence from `MAX(nn)` parsed out of existing names — rejected; the
count is simpler and older rows have no `nn` to parse.

### 3. Original name in a new column, not in `file_name`
`document_attachment.original_file_name varchar null` (DBML + migration). Kept because deleting
information the user gave is not the request — they asked for a readable name, not for theirs to
disappear. Shown as secondary text only; never a key, never a caption. Older rows stay null and the
UI hides the empty line.

### 4. Repair migration: decode only what round-trips
For `document_attachment.file_name` and `payment_attachment.file_name`: a row is repaired when its
current text consists only of characters ≤ U+00FF (a latin1 rendering), and
`Buffer.from(name, 'latin1').toString('utf8')` contains no U+FFFD replacement character and
re-encodes to the same bytes. Anything else — ASCII names, names already correct — is left alone,
so the migration is idempotent and never "repairs" a real French or Vietnamese name into garbage.
Done in SQL with `convert_from(convert_to(file_name, 'LATIN1'), 'UTF8')` guarded by a regex that
the text matches `^[\x00-\xFF]*$` and contains at least one byte ≥ 0x80, inside an exception-safe
`DO` block per row (invalid UTF-8 raises and is skipped). `down` is a no-op with a note: the garbled
text is not worth restoring.

### 5. Frontend shows both names
`AttachmentRow` gains `originalFileName?: string | null`; `AttachmentService.list` returns it;
`AttachmentUploader.vue` prints it as `text-xs text-muted-color` under the name when present and
different. The wizard's staged-files list (before the draft exists) keeps showing the picked file's
own name — nothing has been generated yet.

## Risks / Trade-offs

- [A repaired slip name differs from what a bank statement export shows] → the repaired text IS the
  bank's name; the garbled one was never what anyone typed.
- [A non-Lao Latin-1 name (e.g. `résumé.pdf`) stored garbled] → the round-trip test repairs it too,
  correctly; a genuinely Latin-1 name that was stored correctly contains bytes that are not valid
  UTF-8 sequences and is skipped.
- [Two digits look final] → they are a display convention; `padStart` widens naturally.
- [Users lose the habit of naming files] → intended; the original stays visible beneath.

## Migration Plan

1. DBML + `MigrationYYYYMMDD…_AttachmentOriginalName` (add column).
2. `Migration…_RepairLatin1FileNames` (data repair, idempotent).
3. Code: `multipartOptions`, seven interceptor sites, `AttachmentService.upload/list`, entity,
   frontend.
4. Deploy both targets; no announcement needed.

## Open Questions

- None.
