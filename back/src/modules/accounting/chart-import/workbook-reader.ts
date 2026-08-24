import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import * as XLSX from 'xlsx';

/**
 * One account as the customer's export states it, before anything is derived from it.
 *
 * Deliberately not an `Account`: no parent, no postability, no `AccountType`. Those are decisions
 * this system makes about the data, and keeping them out of the reader is what lets the reader be
 * tested against the real files without a database.
 */
export interface SourceAccount {
  code: string;
  name: string;
  /** The class word exactly as written — `ຊັບສິນ`, `ໜີ້ສິນ`, `ອື່ນໆ`, … Mapped later. */
  klass: string;
  /** Which file it came from, so a collision can name both sides. */
  file: string;
  /** 1-based row in the sheet, so a report can point at it. */
  row: number;
}

/** Labels that identify the header row, in either of the two languages the exports use. */
const CODE_LABELS = ['ເລກບັນຊີ', 'Acct. No.'];
const CLASS_LABELS = ['ໝວດບັນຊີ', 'Type.'];
const HEADER_SEARCH_ROWS = 30;

/**
 * Where the fields live, taken from the header row rather than assumed.
 *
 * The two exports put their header on different rows (13 and 14) and open with a title block of
 * merged cells that shifts everything below it. A fixed offset reads the wrong columns of the next
 * export without failing — it just returns a column of company addresses as account names.
 */
interface Layout {
  headerRow: number;
  code: number;
  klass: number;
}

const text = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  // A code like `1017` arrives as a number; `1017.0001` as a string. Integers must not become
  // `1017.0` on the way through, because the code is an identity.
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  // The exports carry zero-width spaces inside Lao names; they are invisible and break equality.
  return String(v).replace(/​/g, '').trim();
};

function findLayout(rows: unknown[][], file: string): Layout {
  for (let r = 0; r < Math.min(rows.length, HEADER_SEARCH_ROWS); r++) {
    const cells = rows[r] ?? [];
    const code = cells.findIndex((c) => CODE_LABELS.includes(text(c)));
    if (code === -1) continue;
    const klass = cells.findIndex((c) => CLASS_LABELS.includes(text(c)));
    if (klass === -1) continue;
    return { headerRow: r, code, klass };
  }
  throw new Error(
    `${file}: no header row found in the first ${HEADER_SEARCH_ROWS} rows — ` +
      `expected a cell reading one of ${CODE_LABELS.join(' / ')}`,
  );
}

/** A code is digits, optionally with one dotted tail: `1`, `1017`, `1017.0001`, `1213110.20`. */
const CODE = /^\d{1,8}(\.\d+)?$/;

/**
 * Read one chart-of-accounts export.
 *
 * The name is assembled from every cell BETWEEN the code column and the class column. The exports
 * merge that span across a dozen columns and only the first carries a value, so reading a single
 * fixed column would return an empty name for a chart whose merge width happens to differ.
 */
export function readChartFile(path: string): SourceAccount[] {
  const file = basename(path);
  const wb = XLSX.read(readFileSync(path), { type: 'buffer', cellDates: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error(`${file}: workbook has no sheet`);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  });

  const layout = findLayout(rows, file);
  const out: SourceAccount[] = [];
  for (let r = layout.headerRow + 1; r < rows.length; r++) {
    const cells = rows[r] ?? [];
    const code = text(cells[layout.code]);
    if (!CODE.test(code)) continue;
    const name = cells
      .slice(layout.code + 1, layout.klass)
      .map(text)
      .filter(Boolean)
      .join(' ');
    out.push({ code, name, klass: text(cells[layout.klass]), file, row: r + 1 });
  }
  return out;
}
