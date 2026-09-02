import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import * as XLSX from 'xlsx';

/** One plan line as the customer's workbook states it, before anything is derived from it. */
export interface PlanRow {
  /** `1`, `1.1`, `1.101` — the organisation's own numbering. */
  code: string;
  name: string;
  /** The 2026 annual figure, as a decimal STRING (money rule). Absent when the cell is empty. */
  amount?: string;
  /** 1-based row in the sheet, so the report can point at it. */
  row: number;
}

const SHEET = 'ສາລະບານງົບປະມານ';
const CODE_LABELS = ['ລະຫັດ'];
const NAME_LABELS = ['ລາຍການແຕ່ລະຂະແໜງ'];
/** The annual column. `ງົບປະມານ/2024` and `/2025` sit beside it and must not be mistaken for it. */
const AMOUNT_LABEL = /^ງົບປະມານ\/(ປີ)?2026$/;
const HEADER_SEARCH_ROWS = 20;

interface Layout {
  headerRow: number;
  code: number;
  name: number;
  amount: number;
}

const text = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  return String(v).replace(/​/g, '').replace(/\s+/g, ' ').trim();
};

/**
 * Where the fields are, taken from the header row.
 *
 * The amount column is found by matching the YEAR, not by position: the sheet carries
 * `ງົບປະມານ/2024` and `ງົບປະມານ/2025` immediately to its left, and reading one column over would
 * import a prior year's plan while every count still looked right.
 */
function findLayout(rows: unknown[][], file: string): Layout {
  for (let r = 0; r < Math.min(rows.length, HEADER_SEARCH_ROWS); r++) {
    const cells = (rows[r] ?? []).map(text);
    const code = cells.findIndex((c) => CODE_LABELS.includes(c));
    if (code === -1) continue;
    const name = cells.findIndex((c) => NAME_LABELS.includes(c));
    const amount = cells.findIndex((c) => AMOUNT_LABEL.test(c));
    if (name === -1 || amount === -1) continue;
    return { headerRow: r, code, name, amount };
  }
  throw new Error(
    `${file}: no plan header row found in the first ${HEADER_SEARCH_ROWS} rows — ` +
      `expected cells reading ${CODE_LABELS[0]}, ${NAME_LABELS[0]} and ງົບປະມານ/ປີ2026`,
  );
}

/** A plan code is a department, optionally with one dotted tail: `1`, `1.1`, `1.101`. */
const CODE = /^\d{1,3}(\.\d{1,4})?$/;

/** What the sheet held in the code column that is not a plan code, kept so it can be reported. */
export interface IgnoredRow {
  raw: string;
  name: string;
  row: number;
}

export interface PlanFile {
  rows: PlanRow[];
  /** Never silently dropped: a row the reader could not read is a row someone should look at. */
  ignored: IgnoredRow[];
}

/**
 * Read the expenditure-plan sheet.
 *
 * Only four things are read: the code, the name, the annual figure and where the row was. The
 * sheet also carries a monthly column, a quarterly column, a ratio, twelve months of actuals and
 * two prior years — all excluded, in the monthly case deliberately: the system holds one annual
 * figure per budget, settled when `budget_node` was designed.
 *
 * The level marker in the first column is ignored on purpose. It looks like the depth the code
 * cannot express and is not one: measured across this file, level 3 appears on 7 department rows
 * and 2 category rows, level 4 on 17 categories and 388 lines.
 */
export function readPlanFile(path: string, sheetName = SHEET): PlanFile {
  const file = basename(path);
  const wb = XLSX.read(readFileSync(path), { type: 'buffer', cellDates: false });
  const name = wb.SheetNames.includes(sheetName) ? sheetName : wb.SheetNames[0];
  if (!name) throw new Error(`${file}: workbook has no sheet`);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  });

  const layout = findLayout(rows, file);
  const out: PlanRow[] = [];
  const ignored: IgnoredRow[] = [];
  for (let r = layout.headerRow + 1; r < rows.length; r++) {
    const cells = rows[r] ?? [];
    const code = text(cells[layout.code]);
    if (!CODE.test(code)) {
      // Reported rather than dropped in silence. This sheet holds one such row —
      // `8.10900000000001`, a float artifact with no name and no amount — and the next export
      // could hold one that matters.
      if (code) ignored.push({ raw: code, name: text(cells[layout.name]), row: r + 1 });
      continue;
    }
    const raw = cells[layout.amount];
    out.push({
      code,
      name: text(cells[layout.name]),
      // Carried as a string from here on and never as a JS number in any arithmetic. The cell is
      // a float in the workbook — several are fractions of a kip from a spreadsheet division —
      // so it is rounded to whole kip once, here, where the rounding is visible.
      amount: typeof raw === 'number' && raw !== 0 ? Math.round(raw).toString() : undefined,
      row: r + 1,
    });
  }
  return { rows: out, ignored };
}
