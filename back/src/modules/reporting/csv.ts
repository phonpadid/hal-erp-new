/** One CSV column: a header and a cell extractor. Money values must already be strings. */
export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

/** RFC-4180-ish quoting: wrap in quotes when the cell contains a comma, quote, or newline. */
function escapeCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Serialize rows to CSV using the given columns. Monetary fields stay decimal strings — the
 * extractor never coerces money to a JS number. A header line is always emitted.
 */
export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const head = columns.map((c) => escapeCell(c.header)).join(',');
  const body = rows.map((r) => columns.map((c) => escapeCell(c.value(r))).join(',')).join('\n');
  return body ? `${head}\n${body}\n` : `${head}\n`;
}
