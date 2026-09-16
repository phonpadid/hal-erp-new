## 1. Schema

- [x] 1.1 DBML: add `original_file_name varchar [note: 'ชื่อไฟล์ที่ผู้อัปโหลดตั้งมา (ถอด UTF-8 ถูกต้อง) — เก็บไว้ดูเท่านั้น; file_name คือชื่อที่ระบบตั้ง <doc_no>-<nn><ext>']` to `Table document_attachment`; update the `file_name` note to say it is server-generated for new rows
- [x] 1.2 Entity: `DocumentAttachment.originalFileName?: string` (`original_file_name`, nullable) in `back/src/modules/document/document.entities.ts`
- [x] 1.3 Migration `Migration20260917000000` — `alter table document_attachment add column original_file_name varchar null`; `down` drops it; refresh tracked snapshots
- [x] 1.4 Migration `Migration20260917100000` — repair latin1-rendered `file_name` in `document_attachment` and `payment_attachment` per design §4 (round-trip guard, per-row exception-safe, idempotent); `down` no-op with note. Run on the local DB and confirm the sample rows read as Lao

## 2. Backend — UTF-8 filenames

- [x] 2.1 `back/src/common/storage/upload.ts`: add `multipartOptions(maxSizeKb)` returning `{ limits: uploadLimits(maxSizeKb), defParamCharset: 'utf8' }`, typed so `FileInterceptor` accepts it (single cast, comment citing multer `make-middleware.js`)
- [x] 2.2 Replace the options object at all seven `FileInterceptor('file', …)` sites: `document.controller.ts`, `company.controller.ts`, `payment-handoff.controller.ts` (×2), `payment-batch.controller.ts`, `auth.controller.ts` (×2)
- [x] 2.3 Unit test for `multipartOptions` (limits preserved, charset set) in `upload.spec.ts` or alongside the existing limits test

## 3. Backend — generated attachment names

- [x] 3.1 `upload.ts`: `extensionFor(mime)` mapping the three allow-listed types to `.pdf` / `.jpg` / `.png` (throws for anything else — unreachable after `validateUpload`)
- [x] 3.2 `AttachmentService.upload`: wrap in `em.transactional`; lock the `document` row (`PESSIMISTIC_WRITE`); `nn = count(document_attachment where document) + 1`; `fileName = \`${doc.docNo}-${String(nn).padStart(2,'0')}${ext}\``; `originalFileName = file.originalname`; write the object under `buildKey(documentId, fileName)`; persist in the same transaction
- [x] 3.3 `AttachmentService.list` (and any detail payload that returns attachments) includes `originalFileName`
- [x] 3.4 Tests in a new `attachment-naming.spec.ts` (DB-backed): first two uploads → `-01.pdf`, `-02.jpg` with originals kept; PNG bytes under a `.jpeg` name → `.png`; concurrency: `Promise.all` of two uploads → `-01` and `-02`, two rows; a Lao `originalname` round-trips unchanged into `original_file_name`
- [x] 3.5 Check `document-export-assembly.spec.ts` / evidence-page tests still pass (caption = `file_name`)

## 4. Frontend

- [x] 4.1 `front-end/src/api/documents.ts`: `AttachmentRow.originalFileName?: string | null`
- [x] 4.2 `AttachmentUploader.vue`: under the file name, show `originalFileName` as `text-xs text-muted-color` when present and different from `fileName`; no empty line otherwise
- [x] 4.3 Spec beside the component: generated name primary + original secondary; older row shows one line only
- [x] 4.4 Mobile app (`app/`) only displays `fileName` — confirm nothing breaks (no change expected)

## 5. Verify

- [x] 5.1 Backend `vitest` (`DB_PORT=5433 DB_NAME=erp_test`) and frontend `vitest`; both typechecks
- [x] 5.2 On the local stack: upload a Lao-named PDF and a JPEG to a draft → list shows `<docNo>-01.pdf` / `-02.jpg` with Lao originals beneath; export PDF → evidence pages captioned by the generated names; an old attachment with a repaired name reads correctly
