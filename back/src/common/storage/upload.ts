import { BadRequestException } from '@nestjs/common';

/**
 * The subset of a multipart file (Nest's `FileInterceptor` / multer) the upload flows use.
 * Declared locally so services/tests don't depend on multer's global type augmentation.
 */
export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Validate a received upload against a mime allow-list and a size cap, on the ACTUAL bytes —
 * never a client-declared content-type/size. Throws a `BadRequestException` (400) so callers
 * surface a validation error before anything is written to storage. Pass `allow: null` to
 * accept any mime type (e.g. document attachments), enforcing only the size cap.
 *
 * `mimetype` is still browser-supplied and thus spoofable; sniffing magic bytes is a
 * deliberate non-goal (see design.md). This mirrors the trust level of the old presign flow.
 */
export function validateUpload(
  file: UploadedFile | undefined,
  allow: readonly string[] | null,
  maxSizeKb: number,
): asserts file is UploadedFile {
  if (!file || !file.buffer?.length) {
    throw new BadRequestException('No file was uploaded');
  }
  if (allow && !allow.includes(file.mimetype)) {
    throw new BadRequestException(`Unsupported file type: ${file.mimetype}`);
  }
  const sizeKb = Math.ceil(file.size / 1024);
  if (sizeKb > maxSizeKb) {
    throw new BadRequestException(`File is too large (${sizeKb} KB > ${maxSizeKb} KB)`);
  }
}

/**
 * `FileInterceptor` limits for a given cap: a hard byte ceiling a bit above the cap so a
 * grossly oversized body is refused before it is fully buffered (memory bound), while a file
 * just over the cap still reaches `validateUpload` and returns a clean 400 rather than a
 * multer error. Round the ceiling to the cap + 25% (min 1 MB slack).
 */
export function uploadLimits(maxSizeKb: number): { fileSize: number } {
  const capBytes = maxSizeKb * 1024;
  return { fileSize: capBytes + Math.max(capBytes * 0.25, 1024 * 1024) };
}
