/**
 * Reduce a rich-text field value to plain text for a PDF body or a spreadsheet cell. Field values
 * captured by a WYSIWYG editor arrive as HTML (e.g. `<p>123456</p>`); neither pdfkit nor a cell
 * has an HTML engine, so the raw markup would print verbatim. Block tags become line breaks, list items a bullet, every other
 * tag is dropped, and the common entities are decoded (`&amp;` last, so `&amp;lt;` → `&lt;`).
 * Plain-text values pass through unchanged, apart from {@link printableText}.
 */
export function stripHtml(value: string): string {
  return printableText(
    value
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|tr)\s*>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<\/?[a-z][^>]*>/gi, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#0*39;|&apos;/gi, "'")
      .replace(/&amp;/gi, '&'),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * Replace the characters a pasted Word document brings along that the PDF's Lao face has no glyph
 * for, each of which printed as an empty box ("tofu").
 *
 * Word writes a list marker as its own text: a Symbol-font bullet in the Private Use Area
 * (U+F0B7 and its neighbours), then a tab or a run of typographic spaces (en, em, thin, narrow
 * no-break) to reach the indent. None of them is in Noto Sans Lao. Each is mapped to what it was
 * standing for rather than deleted, so a list still reads as a list:
 *  - typographic spaces and tabs → an ordinary space;
 *  - a Private Use Area character → `•`, and a bullet the editor already rendered for the `<li>`
 *    is not doubled;
 *  - the line and paragraph separators → a line break;
 *  - invisible formatting marks (soft hyphen, byte-order mark, direction marks, word joiner) →
 *    nothing.
 * Zero-width space and joiners stay: the face has them, and Lao, written without spaces between
 * words, relies on them for where a line may break.
 */
export function printableText(value: string): string {
  return value
    .replace(/[\u2028\u2029]/g, '\n')
    .replace(/[\t\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
    .replace(/[\uE000-\uF8FF]/g, '•')
    .replace(/•[ ]*•/g, '•')
    .replace(/[\u00AD\u200E\u200F\u2060\uFEFF]/g, '');
}
