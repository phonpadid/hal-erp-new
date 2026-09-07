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
 * The file types evidence may be uploaded as: PDF, JPEG and PNG.
 *
 * Narrow on purpose. An attachment is not only something to download later — it is printed into
 * the document set the company files and signs, and these three are the only types that can be put
 * on a page without a document-conversion engine on the deploy host. Anything else would have to
 * print as a page apologising for itself, which is worse than telling the person at upload time.
 */
export const EVIDENCE_MIME_ALLOWLIST = ['application/pdf', 'image/jpeg', 'image/png'] as const;

/**
 * What each allowed type's bytes actually begin with. The recorded mime type comes from the
 * browser and can say anything; these cannot.
 */
const MAGIC: Record<string, readonly number[][]> = {
  'application/pdf': [[0x25, 0x50, 0x44, 0x46]], // %PDF
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  // JPEG's SOI plus a marker byte; the fourth byte varies by encoder (JFIF, Exif, raw).
  'image/jpeg': [[0xff, 0xd8, 0xff]],
};

/** Whether the buffer starts with one of the signatures declared for `mime`. */
function bytesMatch(buffer: Buffer, mime: string): boolean {
  const signatures = MAGIC[mime];
  if (!signatures) return true; // no signature declared for this type → nothing to check
  return signatures.some((sig) => sig.every((byte, i) => buffer[i] === byte));
}

/**
 * Validate a received upload against a mime allow-list and a size cap, on the ACTUAL bytes —
 * never a client-declared content-type/size. Throws a `BadRequestException` (400) so callers
 * surface a validation error before anything is written to storage. Pass `allow: null` to
 * accept any mime type, enforcing only the size cap.
 *
 * When the allow-list names a type this module has a signature for, the FILE'S OWN leading bytes
 * decide, not the browser-declared `mimetype`. That declaration is caller-supplied and spoofable,
 * and these bytes are no longer only handed back on download: they are merged into the PDF a
 * company prints and signs, where a spreadsheet claiming to be a PDF is a broken document rather
 * than a bad download.
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
  // Checked against the WHOLE allow-list, not only the declared type: a file renamed from .xlsx to
  // .pdf matches nothing here, while a JPEG the browser labelled image/png still goes through —
  // the second is a browser quirk, the first is a file that cannot be printed.
  if (allow && allow.some((mime) => MAGIC[mime]) && !allow.some((mime) => bytesMatch(file.buffer, mime))) {
    throw new BadRequestException(
      `This file is not a ${allow.join(', ')} — its contents do not match its type`,
    );
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
