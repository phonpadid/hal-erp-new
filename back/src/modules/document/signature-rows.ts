/**
 * How the signature row is laid out on every PDF layout — shared by the letter (pdfkit) and the
 * sheets (pdfmake) so the two cannot disagree. Kept out of both so neither imports the other.
 */

/**
 * How many signature columns share one row. A4 holds five legibly — a Lao position title has no
 * spaces to wrap at, so a narrower column would push it into its neighbour. A longer route wraps to
 * further rows, every column the same width, so ten signatures print as two rows of five.
 */
export const SIGNATURES_PER_ROW = 5;

/** Split the signature blocks into rows of at most SIGNATURES_PER_ROW, in order. */
export function signatureRows<T>(blocks: T[], perRow = SIGNATURES_PER_ROW): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < blocks.length; i += perRow) rows.push(blocks.slice(i, i + perRow));
  return rows;
}
