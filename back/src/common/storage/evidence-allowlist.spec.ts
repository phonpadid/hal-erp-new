import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { EVIDENCE_MIME_ALLOWLIST, validateUpload, type UploadedFile } from './upload';

const PDF = Buffer.from('%PDF-1.7\n...');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const XLSX = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]); // a zip, which is what an .xlsx is

function upload(name: string, mimetype: string, buffer: Buffer): UploadedFile {
  return { originalname: name, mimetype, size: buffer.length, buffer };
}

/**
 * What may be attached as evidence, decided by the file's own bytes.
 *
 * The declared mime type comes from the browser and can say anything. That was tolerable while an
 * attachment was only ever handed back on download; it stops being tolerable once these bytes are
 * merged into the PDF the company prints and signs, where a spreadsheet claiming to be a PDF is a
 * broken document rather than a bad download.
 */
describe('evidence upload allow-list', () => {
  const cap = 10 * 1024;

  it('accepts the three types evidence can be printed from', () => {
    expect(() => validateUpload(upload('a.pdf', 'application/pdf', PDF), EVIDENCE_MIME_ALLOWLIST, cap)).not.toThrow();
    expect(() => validateUpload(upload('a.png', 'image/png', PNG), EVIDENCE_MIME_ALLOWLIST, cap)).not.toThrow();
    expect(() => validateUpload(upload('a.jpg', 'image/jpeg', JPEG), EVIDENCE_MIME_ALLOWLIST, cap)).not.toThrow();
  });

  it('refuses a type outside the list', () => {
    expect(() =>
      validateUpload(upload('a.xlsx', 'application/vnd.ms-excel', XLSX), EVIDENCE_MIME_ALLOWLIST, cap),
    ).toThrow(BadRequestException);
  });

  it('refuses a spreadsheet that declares itself a PDF', () => {
    // The whole point of sniffing: the declared type passes the list, the bytes do not.
    expect(() =>
      validateUpload(upload('sneaky.pdf', 'application/pdf', XLSX), EVIDENCE_MIME_ALLOWLIST, cap),
    ).toThrow(/do not match its type/);
  });

  it('accepts a JPEG the browser mislabelled as a PNG', () => {
    // Browsers get this wrong routinely, and the file is still printable. Only files that are none
    // of the three are refused — the check is against the list, not against the label.
    expect(() => validateUpload(upload('photo.png', 'image/png', JPEG), EVIDENCE_MIME_ALLOWLIST, cap)).not.toThrow();
  });

  it('still refuses an oversized file of an allowed type', () => {
    const big = { ...upload('a.pdf', 'application/pdf', PDF), size: cap * 1024 + 1 };
    expect(() => validateUpload(big, EVIDENCE_MIME_ALLOWLIST, cap)).toThrow(/too large/);
  });

  it('leaves callers that allow any type unchanged', () => {
    // `allow: null` still means "any type, size cap only" — the signature check has nothing to
    // check against, and no caller's behaviour changes by adding it.
    expect(() => validateUpload(upload('a.txt', 'text/plain', Buffer.from('hi')), null, cap)).not.toThrow();
  });
});
