import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LAO_FONT_FILE } from '../../modules/document/document-pdf.service';
import { printableText, stripHtml } from './strip-html';

// fontkit is pdfkit's own dependency — resolved through it rather than declared a second time.
const req = createRequire(require.resolve('pdfkit'));
const fontkit = req('fontkit');
const lao = fontkit.openSync(join(__dirname, '../../assets/fonts', LAO_FONT_FILE));
const missingGlyphs = (s: string) =>
  [...s].filter((c) => c !== '\n' && !lao.hasGlyphForCodePoint(c.codePointAt(0)!)).map((c) => c.codePointAt(0)!.toString(16));

/**
 * What a list pasted from Word looks like once the editor has stored it: its own Symbol-font
 * bullet in the Private Use Area, then tabs and typographic spaces to the indent. Every one of
 * those printed as an empty box in the letter.
 */
const WORD_LIST =
  '<p>-ຂັ້ນຕອນແມ່ນ :</p>' +
  '<p>1.\u2003\u2003ລູກຄ້າ ຂໍປ່ຽນປາຍທາງ</p>' +
  '<ul><li>\uF0B7\u2003ກົດເຂົ້າເລກບິນ</li><li>\uF0A7\u2002\u2002ສາຂາປາຍທາງ</li></ul>' +
  '<p>•\t\u202Fຜູ້ຮັບ\u00AD\uFEFF\u200D\u2060</p>' +
  '<p>4.\u2009\u2009ຂໍ້ມູນ ຜູ້ຝາກ\u2028ແລະ ສາຂາຕົ້ນທາງ</p>';

describe('stripHtml — text the Lao PDF face can print', () => {
  it('leaves no character the font has no glyph for, from a list pasted out of Word', () => {
    expect(missingGlyphs(stripHtml(WORD_LIST))).toEqual([]);
  });

  it('keeps the list reading as a list: one bullet per item, one space to the text', () => {
    expect(stripHtml(WORD_LIST).split('\n')).toEqual([
      '-ຂັ້ນຕອນແມ່ນ :',
      '1. ລູກຄ້າ ຂໍປ່ຽນປາຍທາງ',
      '• ກົດເຂົ້າເລກບິນ',
      '• ສາຂາປາຍທາງ',
      '• ຜູ້ຮັບ',
      '4. ຂໍ້ມູນ ຜູ້ຝາກ',
      'ແລະ ສາຂາຕົ້ນທາງ',
    ]);
  });

  it('keeps the zero-width space Lao breaks lines on', () => {
    expect(printableText('ລູກຄ້າ\u200Bສາຂາ')).toBe('ລູກຄ້າ\u200Bສາຂາ');
  });

  it('passes ordinary text through unchanged', () => {
    expect(stripHtml('<p>ວັນທີສະເໜີ: 25/09/2026 &amp; HAL Express</p>')).toBe('ວັນທີສະເໜີ: 25/09/2026 & HAL Express');
  });

  it('numbers a numbered list — the editor saves a list typed as `1.` as <ol>', () => {
    expect(stripHtml('<ol><li>ກ</li><li>ຂ</li><li>ຄ</li></ol><p></p>').split('\n')).toEqual(['1. ກ', '2. ຂ', '3. ຄ']);
  });

  it('counts each numbered list on its own, and leaves a bulleted one bulleted', () => {
    expect(stripHtml('<ol><li>ກ</li><li>ຂ</li></ol><ul><li>ຄ</li></ul><ol><li>ງ</li></ol>').split('\n')).toEqual([
      '1. ກ',
      '2. ຂ',
      '• ຄ',
      '1. ງ',
    ]);
  });
});
