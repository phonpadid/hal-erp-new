import type { UploadedFile } from '../common/storage/upload';

/**
 * The leading bytes a real file of each accepted type begins with. Uploads are validated against
 * these, not against the browser-declared type, so a fixture whose buffer is arbitrary filler is
 * now refused exactly as a mislabelled file would be — which is the point of the check, and the
 * reason these belong in the shared fixture rather than in each spec.
 */
const MAGIC: Record<string, number[]> = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46, 0x2d], // %PDF-
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/jpeg': [0xff, 0xd8, 0xff, 0xe0],
};

/**
 * Build a fake multipart file for the proxy-upload flows. `sizeKb` sets the reported `size`
 * (the buffer content beyond its signature is arbitrary); default 8 KB — small and within every
 * cap. The buffer starts with the signature of `mimetype` when that type has one, so the file
 * passes the same content check a real upload does.
 */
export function fakeUpload(originalname: string, mimetype: string, sizeKb = 8): UploadedFile {
  const size = sizeKb * 1024;
  const buffer = Buffer.alloc(Math.min(size, 64), 1);
  const magic = MAGIC[mimetype];
  if (magic) Buffer.from(magic).copy(buffer);
  return { originalname, mimetype, size, buffer };
}
