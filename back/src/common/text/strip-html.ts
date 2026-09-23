/**
 * Reduce a rich-text field value to plain text for a PDF body or a spreadsheet cell. Field values
 * captured by a WYSIWYG editor arrive as HTML (e.g. `<p>123456</p>`); neither pdfkit nor a cell
 * has an HTML engine, so the raw markup would print verbatim. Block tags become line breaks, list items a bullet, every other
 * tag is dropped, and the common entities are decoded (`&amp;` last, so `&amp;lt;` → `&lt;`).
 * Plain-text values pass through unchanged.
 */
export function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)\s*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
