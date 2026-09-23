import * as XLSX from 'xlsx';
import { Decimal } from 'decimal.js';
import { Money } from '../../common/money/money';

/**
 * One document, already shaped for finance's payables sheet. Everything is a string except the
 * submit date; money stays a decimal string until the moment a cell object is built (D4).
 */
export interface PayablesRow {
  /** `document.submitted_at` — the day the document reached finance's queue. */
  submittedAt: Date | null;
  docNo: string;
  /** The digits the numbering service appended (`0004` of `PR-HAL-2026-0004`). */
  runningNo: string;
  /** `document_type.short_name ?? document_type.code`. */
  typeAbbrev: string;
  /** `department.short_name ?? department.dept_code`. */
  deptAbbrev: string;
  description: string;
  /** `department.name` of the document's own department. */
  departmentName: string;
  /** The root of the document's department tree — the group heading. */
  rootDeptCode: string;
  rootDeptName: string;
  /** ISO code the amount is in; already defaulted to the base currency by the caller. */
  currencyCode: string;
  /** `document.grand_total` as a decimal string. */
  grandTotal: string;
  /**
   * `vendor_bank_account.bank_code` of the payee the document names (`BCEL`, `LDB`), or empty
   * when it names none. The one decision column the system can answer — the requester already
   * chose the destination; which of the company's own accounts pays stays finance's.
   */
  payeeBank: string;
}

export interface PayablesWorkbookOptions {
  /** Title row text, e.g. `ລາຍຈ່າຍຄ້າງໃໝ່ປະຈຳປີ 2026`. */
  title: string;
  /** `currency.decimal_places` by code, for the cell number format. Unknown codes get 2. */
  decimalPlaces: Record<string, number>;
}

/**
 * The currency columns finance's sheet always carries, in its order, headed the way the sheet
 * heads them. Any other currency present in the rows follows these, headed by its code.
 */
const FIXED_CURRENCIES: ReadonlyArray<[code: string, header: string]> = [
  ['LAK', 'ເງິນກີບ'],
  ['THB', 'ເງິນບາດ'],
  ['USD', 'ເງິນໂດລາ'],
  ['CNY', 'ເງິນຢວນ'],
];

/** Header row, in finance's column order; the currency columns are spliced in at `AMOUNTS_AT`. */
const HEAD_BEFORE = [
  'ວັນທີ່ເອກະສານມາ',
  'ລ/ດ',
  'ເລກທີ ການເງິນ',
  'ເລກທີພະແນກ',
  'ລາຍການ',
  'ພາກສ່ວນ',
];
const HEAD_AFTER = ['ບັນຊີ', 'ຫຼັກ', 'ສຳຮອງ', 'ໝາຍເຫດ'];
const AMOUNTS_AT = HEAD_BEFORE.length;

type Cell = XLSX.CellObject | null;

/** `#,##0` for 0 places, `#,##0.00` for 2 — the sheet's own number style, per currency. */
function numberFormat(places: number): string {
  return places > 0 ? `#,##0.${'0'.repeat(places)}` : '#,##0';
}

/**
 * A money cell. The string is the truth; the JS number exists only inside this cell object,
 * because that is the only thing the workbook library can write. Rounded to the currency's places
 * for display, not arithmetic'd.
 */
function moneyCell(amount: string, places: number): XLSX.CellObject {
  const fixed = new Decimal(amount).toFixed(places);
  return { t: 'n', v: Number(fixed), z: numberFormat(places) };
}

function textCell(text: string): XLSX.CellObject {
  return { t: 's', v: text };
}

/**
 * A date cell as the classic Excel serial (days since 1899-12-30) with a date format — NOT the
 * `t: 'd'` ISO-string cell type, which Google Sheets and older Excel builds render as an empty
 * cell. Date only: the sheet's column is a day, and a time would defeat the date filter.
 */
function dateCell(d: Date): XLSX.CellObject {
  const day = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const serial = (day - Date.UTC(1899, 11, 30)) / 86_400_000;
  return { t: 'n', v: serial, z: 'dd/mm/yyyy' };
}

/** Per-currency running sums as strings, `Money.add` only. */
class Totals {
  private readonly sums = new Map<string, string>();
  add(code: string, amount: string): void {
    this.sums.set(code, Money.add(this.sums.get(code) ?? '0', amount));
  }
  get(code: string): string | undefined {
    return this.sums.get(code);
  }
}

/**
 * Build finance's payables sheet from shaped rows. Pure: no database, no HTTP. Rows are grouped
 * under their top-level department (ordered by root `dept_code`), each group headed and
 * subtotalled, then a grand total — every total per currency column only, never across.
 *
 * Within a group rows keep the order they were given; the caller sorts (newest first).
 */
export function buildPayablesWorkbook(
  rows: PayablesRow[],
  opts: PayablesWorkbookOptions,
): Buffer {
  const currencies = currencyColumns(rows);
  const places = (code: string) => opts.decimalPlaces[code] ?? 2;
  const width = HEAD_BEFORE.length + currencies.length + HEAD_AFTER.length;

  const sheetRows: Cell[][] = [];
  const merges: XLSX.Range[] = [];

  // Title, merged across the columns the sheet spans (finance's sheet merges B..N; ours spans all).
  sheetRows.push([textCell(opts.title), ...blanks(width - 1)]);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: width - 1 } });

  sheetRows.push([
    ...HEAD_BEFORE.map(textCell),
    ...currencies.map(([, header]) => textCell(header)),
    ...HEAD_AFTER.map(textCell),
  ]);

  const amountCells = (totals: Totals): Cell[] =>
    currencies.map(([code]) => {
      const sum = totals.get(code);
      return sum === undefined ? null : moneyCell(sum, places(code));
    });

  const grand = new Totals();
  let index = 0;
  for (const group of groupByRoot(rows)) {
    // Group heading: the root's name, with the sub-departments present in parentheses.
    const children = [
      ...new Set(group.rows.map((r) => r.departmentName)),
    ].filter((n) => n !== group.rootName);
    const heading = children.length
      ? `${group.rootName} (${children.join(', ')})`
      : group.rootName;
    sheetRows.push([null, textCell(heading), ...blanks(width - 2)]);
    merges.push({
      s: { r: sheetRows.length - 1, c: 1 },
      e: { r: sheetRows.length - 1, c: width - 1 },
    });

    const sub = new Totals();
    for (const r of group.rows) {
      index += 1;
      sub.add(r.currencyCode, r.grandTotal);
      grand.add(r.currencyCode, r.grandTotal);
      const amounts: Cell[] = currencies.map(([code]) =>
        code === r.currencyCode ? moneyCell(r.grandTotal, places(code)) : null,
      );
      sheetRows.push([
        r.submittedAt ? dateCell(r.submittedAt) : null,
        { t: 'n', v: index },
        null, // ເລກທີ ການເງິນ — finance's to assign
        textCell(`${r.runningNo}/${r.typeAbbrev}/${r.deptAbbrev}`),
        textCell(r.description),
        textCell(r.departmentName),
        ...amounts,
        r.payeeBank ? textCell(r.payeeBank) : null, // ບັນຊີ — the payee's bank
        null, // ຫຼັກ
        null, // ສຳຮອງ
        null, // ໝາຍເຫດ
      ]);
    }
    sheetRows.push([
      ...blanks(AMOUNTS_AT - 1),
      textCell('ລວມ'),
      ...amountCells(sub),
      ...blanks(HEAD_AFTER.length),
    ]);
  }
  sheetRows.push([
    ...blanks(AMOUNTS_AT - 1),
    textCell('ລວມທັງໝົດ'),
    ...amountCells(grand),
    ...blanks(HEAD_AFTER.length),
  ]);

  const ws = XLSX.utils.aoa_to_sheet(sheetRows);
  ws['!merges'] = merges;
  ws['!cols'] = [
    { wch: 14 },
    { wch: 5 },
    { wch: 14 },
    { wch: 18 },
    { wch: 60 },
    { wch: 16 },
    ...currencies.map(() => ({ wch: 16 })),
    { wch: 8 },
    { wch: 8 },
    { wch: 8 },
    { wch: 24 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function blanks(n: number): Cell[] {
  return Array.from({ length: Math.max(0, n) }, () => null);
}

/** The fixed four, then any other currency the rows carry, alphabetically, headed by its code. */
function currencyColumns(
  rows: PayablesRow[],
): Array<[code: string, header: string]> {
  const fixed = new Set(FIXED_CURRENCIES.map(([c]) => c));
  const extra = [...new Set(rows.map((r) => r.currencyCode))]
    .filter((c) => !fixed.has(c))
    .sort();
  return [...FIXED_CURRENCIES, ...extra.map((c): [string, string] => [c, c])];
}

interface Group {
  rootCode: string;
  rootName: string;
  rows: PayablesRow[];
}

/** Groups keyed by root department, ordered by root `dept_code`; rows keep their given order. */
function groupByRoot(rows: PayablesRow[]): Group[] {
  const byRoot = new Map<string, Group>();
  for (const r of rows) {
    let g = byRoot.get(r.rootDeptCode);
    if (!g) {
      g = { rootCode: r.rootDeptCode, rootName: r.rootDeptName, rows: [] };
      byRoot.set(r.rootDeptCode, g);
    }
    g.rows.push(r);
  }
  return [...byRoot.values()].sort((a, b) =>
    a.rootCode.localeCompare(b.rootCode),
  );
}
