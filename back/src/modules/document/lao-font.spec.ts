import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LAO_FONT_FILE } from './document-pdf.service';

// fontkit is pdfkit's own dependency — resolved through it rather than declared a second time.
const fontkit = createRequire(require.resolve('pdfkit'))('fontkit');
const font = fontkit.openSync(join(__dirname, '..', '..', 'assets', 'fonts', LAO_FONT_FILE));

/**
 * The face every PDF is set in.
 *
 * pdfkit writes the font's PostScript name into the PDF as the name object `/BaseFont /…`. The
 * Phetsarath OT file as distributed is named `Phetsarath_OT(Modified_28_04_14)`, and `(` `)` are
 * delimiters in PDF syntax: the font dictionary no longer parsed, and Chrome and Preview dropped the
 * embedded font and drew every character as the wrong glyph. The bundled copy is renamed; this
 * keeps a future replacement from bringing the problem back.
 */
describe('the bundled Lao face', () => {
  it('has a PostScript name that is a legal PDF name', () => {
    expect(font.postscriptName).toMatch(/^[A-Za-z0-9-]+$/);
  });

  it('carries Latin, digits and the kip sign as well as Lao', () => {
    const needed = 'ABCXYZabcxyz0123456789ສະບາຍດີຜູ້ອຳນວຍການ₭•—';
    expect([...needed].filter((c) => !font.hasGlyphForCodePoint(c.codePointAt(0)!))).toEqual([]);
  });
});
