import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { extensionFor, multipartOptions, uploadLimits } from './upload';

/**
 * Two small helpers behind every upload endpoint.
 *
 * `multipartOptions` exists for one key: without `defParamCharset: 'utf8'` busboy decodes the
 * multipart filename as latin1 and a Lao name arrives as one character per UTF-8 byte — which is
 * how 29 of 45 attachment names on the production copy came to be stored garbled. The limits it
 * carries are the ones every endpoint already had, so switching to the helper changes nothing else.
 *
 * `extensionFor` names the stored file from the type the bytes were checked against, so the
 * extension can never contradict the content the way a browser-supplied name can.
 */
describe('multipartOptions', () => {
  it('asks busboy for UTF-8 filenames and keeps the size ceiling for the cap', () => {
    const opts = multipartOptions(10 * 1024) as { limits?: { fileSize?: number }; defParamCharset?: string };
    expect(opts.defParamCharset).toBe('utf8');
    expect(opts.limits).toEqual(uploadLimits(10 * 1024));
  });
});

describe('extensionFor', () => {
  it('maps each allow-listed type to the extension the file is stored under', () => {
    expect(extensionFor('application/pdf')).toBe('.pdf');
    expect(extensionFor('image/jpeg')).toBe('.jpg');
    expect(extensionFor('image/png')).toBe('.png');
  });

  it('refuses to guess for a type the allow-list does not name', () => {
    expect(() => extensionFor('application/vnd.ms-excel')).toThrow(BadRequestException);
  });
});
