## Why

Today the browser PUTs file bytes **directly** to the S3/MinIO bucket using a presigned
URL. That direct browser→bucket hop requires a CORS policy on the bucket itself, and — with
AWS SDK v3 ≥ 3.729 baking an empty-body CRC32 into presigned PUT URLs — currently fails at
upload time (the profile-image upload returns a CORS/checksum error even though the presign
call succeeds). Routing uploads **through the backend** removes the cross-origin hop entirely:
the browser only ever talks to the same-origin API, so there is no bucket CORS to configure
and no presigned-PUT checksum to reconcile.

## What Changes

- **BREAKING (internal API):** Replace the three presigned-**upload** flows with a single
  authenticated **proxy-upload** endpoint per feature. The browser POSTs the file bytes
  (multipart) to the backend; the backend validates and streams them to object storage,
  then returns the stored object key. Presigned **download** URLs are unchanged.
  - Profile image: `POST /auth/profile-image/presign-upload` → `POST /auth/profile-image/upload`
  - Signature: `POST /auth/signature/presign-upload` → `POST /auth/signature/upload`
  - Document attachment: `POST …/attachments/presign-upload` → `POST …/attachments/upload`
  - Company image: `POST /companies/:id/profile-image/presign-upload` → `POST /companies/:id/profile-image/upload`
- Add `StorageService.putObject(key, bytes, contentType)` (server-side write) alongside the
  existing `getObject`; retire `presignUpload`.
- Server-side enforcement of the mime allow-list and size cap on the received bytes (no
  longer trusting a client-declared `contentType`/`fileSizeKb`); reject oversized/non-image
  uploads with a validation error before anything reaches the bucket.
- Frontend: swap the two-step "presign then PUT to S3" for a single multipart POST to the
  API; drop the direct-to-bucket fetch.
- Update the storage-layer design note that currently states "attachment bytes never pass
  through the API" — that principle is being deliberately reversed for uploads.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `document-engine`: "Attachments on External Storage" — bytes are uploaded via an
  authenticated API endpoint (backend → bucket), not a presigned browser→bucket PUT.
- `document-signatures`: "Register and Replace Own Signature" — the signature image is
  uploaded to the backend, which writes it to object storage; download stays presigned.
- `user-profile`: formalize the profile-image upload as a backend proxy-upload requirement
  (the flow existed in code without a spec requirement).
- `multi-company`: formalize the company profile-image (logo) upload as a backend
  proxy-upload requirement, guarded by `COMPANY_MANAGE` (the flow existed in code without a
  spec requirement).

## Impact

- **Code:** `common/storage/storage.service.ts` (add `putObject`, remove `presignUpload`);
  `modules/rbac/profile.service.ts`, `signature.service.ts`, `modules/document/attachment.service.ts`
  (upload methods); `auth.controller.ts`, `document.controller.ts` (multipart endpoints,
  `FileInterceptor`); the matching DTOs; frontend upload composables/views for profile image,
  signature, and document attachments.
- **APIs:** three presign-upload endpoints replaced by three multipart upload endpoints; the
  `register`/`set` step-3 endpoints may fold into the upload response.
- **Dependencies:** requires NestJS multipart handling (`@nestjs/platform-express` +
  `multer`); adds a server-side request body-size limit for uploads.
- **Ops:** the bucket no longer needs a browser-facing CORS policy for PUT; backend memory
  now briefly holds each uploaded file — keep the size cap tight (profile image 5 MB).
- **Invariants:** no core invariant (1–8) is affected — this is transport only; company
  scope, permission-code guards, and append-only ledgers are unchanged. Document attachments
  keep active-company scoping on the upload endpoint.
