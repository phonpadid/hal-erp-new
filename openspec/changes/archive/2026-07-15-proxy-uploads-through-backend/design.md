## Context

Three features upload files today — profile image (`ProfileService`), user signature
(`SignatureService`), and document attachments (`AttachmentService`) — all sharing one
pattern via `StorageService`:

1. Browser POSTs `{ fileName, contentType }` to the API → gets `{ uploadUrl, key }`.
2. Browser PUTs the raw bytes **directly to the S3/MinIO bucket** using the presigned URL.
3. Browser POSTs `{ filePath, mimeType, fileSizeKb }` back to the API to register the object.

Step 2 is a cross-origin request from the SPA origin to the bucket host. It needs a bucket
CORS policy, and AWS SDK v3 (≥ 3.729, this repo runs 3.1075) now bakes an empty-body CRC32
(`x-amz-checksum-crc32=AAAAAA==`) into presigned PUT URLs, so the real upload is rejected.
The profile-image upload currently fails for exactly this reason.

`StorageService` already writes and reads server-side (`getObject` is used to embed a
signature into a PDF), so proxying uploads through the backend fits the existing surface.
The DBML is unaffected — `document_attachment`, `user_signature`, and
`app_user.profile_image_path` still store only the object key + metadata.

## Goals / Non-Goals

**Goals:**
- Remove the browser→bucket hop so uploads work with no bucket CORS and no presigned-PUT
  checksum dependency.
- One authenticated multipart endpoint per feature; validation (mime allow-list + size cap)
  enforced server-side on the actual bytes.
- Preserve every invariant: JWT-resolved user identity, active-company scope on attachments,
  immutable-row semantics for signatures, presigned-GET downloads unchanged.

**Non-Goals:**
- Changing how files are **read** (presigned download URLs stay as-is).
- Streaming/multipart-chunked or resumable uploads — a single multipart POST with a size cap
  is enough for images and typical receipts.
- Virus scanning, image re-encoding, or thumbnailing (can be a later change).
- Changing storage backend, bucket layout, or object-key schemes.

## Decisions

**1. Multipart POST proxied through the backend, over presigned-PUT variants.**
The browser sends `multipart/form-data` to e.g. `POST /auth/profile-image/upload`; the
endpoint uses Nest's `FileInterceptor` (`@nestjs/platform-express` + `multer`, memory
storage) and hands the buffer to `StorageService.putObject(key, buffer, contentType)`.
- *Alternative — keep presigned PUT, just fix it* (set `requestChecksumCalculation:
  'WHEN_REQUIRED'` + add bucket CORS): smaller change, but leaves the browser→bucket hop and
  its CORS/credential surface in place; the user explicitly asked to route through the
  backend. We still apply the checksum config fix as defense-in-depth for the remaining
  server-side presigned-GET calls.
- *Alternative — stream the request body straight to S3 (`Upload` from `@aws-sdk/lib-storage`)*:
  avoids buffering the whole file in memory. Overkill at a 5 MB image / small-receipt cap;
  revisit if large attachments appear.

**2. Collapse step-2 + step-3 into the single upload call.** The upload endpoint writes the
object **and** performs the register/set write in one flow, returning the same shape the
old step-3 returned (e.g. `{ profileImageUrl }`, `OwnSignature`, the `DocumentAttachment`).
The client no longer round-trips a client-declared `filePath`. Signature/profile-image
writes keep their `em.transactional` + `PESSIMISTIC_WRITE` row lock exactly as today.
- *Rationale:* a client-supplied `filePath` was only ever needed because the browser did the
  PUT. With the backend holding the bytes, it also owns the key — removing a spoofable field.

**3. Validate on the received bytes, not client claims.** Size cap is checked against the
actual buffer length; mime type is taken from the multipart part and checked against the
existing allow-lists (`PROFILE_IMAGE_MIME_ALLOWLIST`, signature/attachment lists). `multer`
`limits.fileSize` is the first-line guard so oversized bodies are rejected before buffering
completes; the service re-checks and maps to a `BadRequestException` (validation error).

**4. `StorageService`: add `putObject`, remove `presignUpload`.** `putObject(key, body,
contentType)` issues a `PutObjectCommand` via the existing lazily-loaded client. Keep the
`requestChecksumCalculation: 'WHEN_REQUIRED'` config already added so server-side PUTs don't
carry a spurious checksum. `presignDownload` and `getObject` are untouched.

## Risks / Trade-offs

- **Backend now buffers upload bytes in memory** → cap `multer` `limits.fileSize` per
  endpoint (profile image/signature 5 MB; attachments to the document limit) and set the
  matching global body limit so a large POST can't exhaust memory.
- **API bandwidth/latency now carries file bytes** (previously offloaded to S3) → acceptable
  for images and receipts at current volume; documented as a Non-Goal to optimize now, and
  the streaming `Upload` alternative is the escape hatch if attachment sizes grow.
- **Breaking internal API contract** (endpoints + request/response shapes change) → frontend
  and backend ship together; no third-party consumer. Old presign endpoints are removed, not
  left dangling, so nothing silently keeps hitting the broken direct-PUT path.
- **Losing the "bytes never pass through the API" property** → a deliberate, documented
  reversal for uploads only; reads still never stream through the API for large objects.

## Migration Plan

1. Backend: add `putObject`, add multipart upload endpoints + DTOs, wire `FileInterceptor`
   and size limits; keep old presign endpoints temporarily to avoid a hard cutover window.
2. Frontend: switch each of the three upload flows to the multipart POST.
3. Remove the presign-upload endpoints, `presignUpload`, and the now-unused
   `Presign*Dto`/`Register*Dto` client fields once no caller remains.
4. Ops: no bucket CORS change required for the new path; existing presigned-GET keeps working.
- **Rollback:** revert the frontend to the presign flow and restore the presign endpoints;
  since download is unchanged, already-stored objects are unaffected either way.

## Open Questions

- Should the document-attachment upload keep a separate `register` step for the rare case of
  attaching an already-stored object, or fully collapse? (Leaning fully collapse — no such
  caller exists today.)
- Confirm the attachment size cap value to enforce (profile image is 5 MB; attachments have
  no explicit cap in code yet).
