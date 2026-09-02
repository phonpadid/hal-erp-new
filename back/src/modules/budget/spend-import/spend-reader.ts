import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import * as XLSX from 'xlsx';

/** One disbursement as the customer's monitoring sheet states it, before anything is derived. */
export interface SpendRow {
  /** `ເລກລຳດັບ` — their own running number, kept so a figure here can be traced back to a row. */
  sequence?: string;
  day: number;
  month: number;
  year: number;
  /** `CODE ພະແນກ` — who spent. Recorded on the document; never used to choose the budget. */
  departmentCode: string;
  /** `CODE (.)` — the plan line charged. This is what decides the budget. */
  code: string;
  description: string;
  /** The kip figure, as a decimal STRING (money rule). Absent when the row states none. */
  amount?: string;
  /** 1-based row in the sheet, so the report can point at it. */
  row: number;
}

/** A row the reader could read but the import cannot use, kept so the report can name it. */
export interface SkippedRow {
  row: number;
  reason: 'NO_AMOUNT' | 'NO_MONTH' | 'NO_CODE';
  code: string;
  description: string;
  /** Present when the row states money the import is leaving out. */
  amount?: string;
}

export interface SpendFile {
  rows: SpendRow[];
  skipped: SkippedRow[];
}

const SHEET = 'ຕິດຕາມງົບປະມານ';
const HEADER_SEARCH_ROWS = 20;

/** Header labels. `D`/`M`/`Y` are single letters, so they are matched exactly, never by prefix. */
const DAY_LABEL = 'D';
const MONTH_LABEL = 'M';
const YEAR_LABEL = 'Y';
const DEPT_LABEL = 'CODE ພະແນກ';
const CODE_LABEL = 'CODE (.)';
const RATE_LABEL = 'ອັດຕາ ແລກປຽນ';
const KIP_LABEL = 'ກີບ';
/** The sequence column's header is a single orphan `ເ` in this export; the full label may return. */
const SEQUENCE_LABEL = /^ເ(ລກລຳດັບ)?$/;

interface Layout {
  headerRow: number;
  sequence?: number;
  day: number;
  month: number;
  year: number;
  department: number;
  code: number;
  description: number;
  amount: number;
}

const text = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  // Zero-width spaces hide inside the Lao text, and the headers carry hard line breaks.
  return String(v).replace(/​/g, '').replace(/\s+/g, ' ').trim();
};

/**
 * Where the fields are, taken from the header row.
 *
 * Two columns are found from a neighbour rather than from a label of their own, because the sheet
 * does not label them: the kip TOTAL — `(ກີບ + ບາດ + ຢວນ + ໂດລາ) × rate` — sits in the unlabelled
 * column immediately right of the rate, and the description sits immediately left of `ກີບ`, under
 * a header that reads `ເປັນເງິນກີບ` and belongs to the total. Anchoring both to a label that IS
 * there is as close to reading the sheet as this sheet allows; a fixed column index would read a
 * currency amount as a description without failing.
 */
function findLayout(rows: unknown[][], file: string): Layout {
  for (let r = 0; r < Math.min(rows.length, HEADER_SEARCH_ROWS); r++) {
    const cells = (rows[r] ?? []).map(text);
    const code = cells.indexOf(CODE_LABEL);
    if (code === -1) continue;
    const day = cells.indexOf(DAY_LABEL);
    const month = cells.indexOf(MONTH_LABEL);
    const year = cells.indexOf(YEAR_LABEL);
    const department = cells.indexOf(DEPT_LABEL);
    const rate = cells.indexOf(RATE_LABEL);
    const kip = cells.indexOf(KIP_LABEL);
    if (day === -1 || month === -1 || year === -1 || department === -1) continue;
    if (rate === -1 || kip === -1) continue;
    const sequence = cells.findIndex((c) => SEQUENCE_LABEL.test(c));
    return {
      headerRow: r,
      sequence: sequence === -1 ? undefined : sequence,
      day,
      month,
      year,
      department,
      code,
      description: kip - 1,
      amount: rate + 1,
    };
  }
  throw new Error(
    `${file}: no spend header row found in the first ${HEADER_SEARCH_ROWS} rows — ` +
      `expected cells reading ${CODE_LABEL}, ${DEPT_LABEL}, D, M, Y and ${RATE_LABEL}`,
  );
}

/** A plan code is a department, optionally with one dotted tail: `1`, `1.1`, `1.101`. */
const CODE = /^\d{1,3}(\.\d{1,4})?$/;

const wholeKip = (v: unknown): string | undefined => {
  // Several cells are fractions of a kip, out of a spreadsheet division. Rounded once, here,
  // where the rounding is visible — the same rule the plan reader applies to the plan's own
  // figures, so the two sides of the comparison round the same way.
  if (typeof v !== 'number' || !Number.isFinite(v) || v === 0) return undefined;
  return Math.round(v).toString();
};

/**
 * Read the daily expenditure sheet.
 *
 * Only the converted kip column is read, never the four per-currency columns beside it: those are
 * its inputs, and summing them would add a baht figure to a kip one. The remark column is not read
 * at all — it says `ຈ່າຍແລ້ວ` in 26 spellings on 36% of rows, which is not a status.
 */
export function readSpendFile(path: string, sheetName = SHEET): SpendFile {
  const file = basename(path);
  const wb = XLSX.read(readFileSync(path), { type: 'buffer', cellDates: false });
  const name = wb.SheetNames.includes(sheetName) ? sheetName : wb.SheetNames[0];
  if (!name) throw new Error(`${file}: workbook has no sheet`);
  const cells = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  });

  const layout = findLayout(cells, file);
  const rows: SpendRow[] = [];
  const skipped: SkippedRow[] = [];
  for (let r = layout.headerRow + 1; r < cells.length; r++) {
    const c = cells[r] ?? [];
    const code = text(c[layout.code]);
    const description = text(c[layout.description]);
    const amount = wholeKip(c[layout.amount]);
    if (!CODE.test(code)) {
      // Reported rather than dropped in silence. This sheet holds 24 such rows — mostly
      // `ຍົກເລີກ`, cancelled requests left in place — but three of them state real money.
      if (code || description || amount) {
        skipped.push({ row: r + 1, reason: 'NO_CODE', code, description, amount });
      }
      continue;
    }
    const month = Number(c[layout.month]);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      // One row of this sheet is shifted a column and puts the year where the month belongs. The
      // day it really means is legible to a person and not to this reader, so it is named, not
      // guessed: a wrong month moves money into the wrong quarter, which is the one thing the
      // quarterly view exists to state.
      skipped.push({ row: r + 1, reason: 'NO_MONTH', code, description, amount });
      continue;
    }
    if (!amount) {
      skipped.push({ row: r + 1, reason: 'NO_AMOUNT', code, description });
      continue;
    }
    const sequence = layout.sequence === undefined ? '' : text(c[layout.sequence]);
    rows.push({
      sequence: sequence || undefined,
      day: Number(c[layout.day]) || 1,
      month,
      year: Number(c[layout.year]),
      departmentCode: text(c[layout.department]),
      code,
      description,
      amount,
      row: r + 1,
    });
  }
  return { rows, skipped };
}
