## 1. Storage layer

- [x] 1.1 Add `putObject(key, body, contentType)` to `StorageService` issuing a `PutObjectCommand` via the existing lazily-loaded client; keep `requestChecksumCalculation: 'WHEN_REQUIRED'` on the client config
- [x] 1.2 Remove `presignUpload` from `StorageService` and update its doc comment to state uploads now pass through the API (reads still go direct via presigned GET)
- [x] 1.3 Install `multer` + `@types/multer` (FileInterceptor runtime dep) and add a shared upload helper (`common/storage/upload.ts`): an `UploadedFile` type, `validateUpload(file, allow, maxSizeKb)` that throws `BadRequestException` on disallowed mime / oversize, and a multer size-ceiling limit

## 2. Profile image (user-profile)

- [x] 2.1 Replace `PresignImageDto`/`RegisterImageDto` usage with an upload flow: `ProfileService.uploadProfileImage(userId, file)` validates mime + size on the received buffer, calls `putObject`, sets `app_user.profile_image_path` under `em.transactional` + `PESSIMISTIC_WRITE`, returns `{ profileImageUrl }`
- [x] 2.2 Replace `POST /auth/profile-image/presign-upload` (+ the `POST /auth/profile-image` register step) with `POST /auth/profile-image/upload` using `FileInterceptor` and multer size limit; remove the presign endpoint
- [x] 2.3 Update `PROFILE_IMAGE_MIME_ALLOWLIST` validation to run against the multipart part's mime type server-side

## 3. Signature (document-signatures)

- [x] 3.1 Add `SignatureService.upload(userId, file)` that validates image mime + size, calls `putObject`, then performs the existing NEW-immutable-row + `current_signature_id` re-point inside `em.transactional` with `PESSIMISTIC_WRITE`
- [x] 3.2 Replace `POST /auth/signature/presign-upload` (+ register step) with `POST /auth/signature/upload` using `FileInterceptor`; keep `remove-bg` unchanged; remove the presign endpoint
- [x] 3.3 Retire `PresignSignatureDto`/`RegisterSignatureDto` fields no longer sent by the client

## 4. Document attachments (document-engine)

- [x] 4.1 Add `AttachmentService.upload(documentId, file)` that resolves the document in the active company, validates mime + size, calls `putObject` with `buildKey`, and records `document_attachment` metadata
- [x] 4.2 Replace the attachment `presign-upload` endpoint with `POST …/attachments/upload` using `FileInterceptor` on `document.controller.ts`; preserve the active-company scope and permission-code guard; remove the presign endpoint
- [x] 4.3 Retire `PresignUploadDto`/`RegisterAttachmentDto` fields no longer needed

## 5. Company profile image (multi-company)

- [x] 5.1 Add `CompanyService.uploadProfileImage(id, file)` that resolves the company, validates image mime + size, calls `putObject` with `buildProfileImageKey('company', id, …)`, sets `company.profile_image_path`, and returns `{ profileImageUrl }`
- [x] 5.2 Replace `POST /companies/:id/profile-image/presign-upload` (+ set step) with `POST /companies/:id/profile-image/upload` using `FileInterceptor`, keeping the `COMPANY_MANAGE` guard; remove the presign endpoint
- [x] 5.3 Retire `PresignImageDto`/`RegisterImageDto` (shared image DTO) once no caller remains; keep the mime allow-list + size-cap constants

## 6. Frontend

- [x] 6.1 Profile image: replace the two-step "presign then PUT to S3" with a single multipart `POST /auth/profile-image/upload`; drop the direct-to-bucket fetch
- [x] 6.2 Signature: switch upload to multipart POST to the backend
- [x] 6.3 Document attachment: switch upload to multipart POST to the backend
- [x] 6.4 Company image: switch `uploadCompanyProfileImage` to multipart POST to the backend
- [x] 6.5 Keep client-side mime/size guards (UX only) mirroring the server allow-lists; surface server validation errors

## 7. Tests & validation

- [x] 7.1 Update/extend backend tests for the four upload services: happy path writes object + metadata, oversized/non-image rejected with a validation error before any write
- [x] 7.2 Attachment upload test asserts active-company scope (cross-company document id → not found) and permission-code guard; company image test asserts `COMPANY_MANAGE`
- [x] 7.3 Signature upload concurrency test: two concurrent uploads leave `current_signature_id` pointing at a fully-written row (row lock holds)
- [x] 7.4 Run `openspec validate proxy-uploads-through-backend` and the backend/frontend test suites; remove any dead presign code paths
