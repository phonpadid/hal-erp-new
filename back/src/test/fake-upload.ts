import type { UploadedFile } from '../common/storage/upload';

/**
 * Build a fake multipart file for the proxy-upload flows. `sizeKb` sets the reported `size`
 * (the buffer content is arbitrary); default 8 KB — small and within every cap.
 */
export function fakeUpload(originalname: string, mimetype: string, sizeKb = 8): UploadedFile {
  const size = sizeKb * 1024;
  return { originalname, mimetype, size, buffer: Buffer.alloc(Math.min(size, 64), 1) };
}
