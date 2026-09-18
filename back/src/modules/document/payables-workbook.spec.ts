import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { buildPayablesWorkbook, type PayablesRow } from './payables-workbook';

/**
 * The builder is pure, so it is tested the way finance will read it: write the buffer, read it
 * back with the same library, and look at cells.
 */
const OPTS = {
  title: 'ລາຍຈ່າຍຄ້າງໃໝ່ປະຈຳປີ 2026',
  decimalPlaces: { LAK: 0, THB: 2, USD: 2, CNY: 2 },
};

function row(over: Partial<PayablesRow> = {}): PayablesRow {
  return {
    submittedAt: new Date(2026, 8, 15, 13, 45),
    docNo: 'PR-HAL-2026-0004',
    runningNo: '0004',
    typeAbbrev: 'ຈຊຈ',
    deptAbbrev: 'ບຫ',
    description: 'ຈັດຊື້ ຕິດຟີມລົດ',
    departmentName: 'ພະແນກບໍລິຫານ',
    rootDeptCode: 'ADM',
    rootDeptName: 'ພະແນກບໍລິຫານ',
    currencyCode: 'LAK',
    grandTotal: '1000000.00',
    payeeBank: '',
    ...over,
  };
}

/** The sheet as a matrix of raw cell values (dates as Date, numbers as number, blanks as undefined). */
function grid(buf: Buffer): unknown[][] {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: true,
    defval: undefined,
  });
}

const HEADER = 1;
const COL = {
  date: 0,
  index: 1,
  finNo: 2,
  deptNo: 3,
  desc: 4,
  section: 5,
  LAK: 6,
  THB: 7,
  USD: 8,
  CNY: 9,
};

describe('buildPayablesWorkbook', () => {
  it("writes the title, then the Lao headers in finance's order with the four currencies", () => {
    const g = grid(buildPayablesWorkbook([row()], OPTS));
    expect(g[0][0]).toBe('ລາຍຈ່າຍຄ້າງໃໝ່ປະຈຳປີ 2026');
    expect(g[HEADER]).toEqual([
      'ວັນທີ່ເອກະສານມາ',
      'ລ/ດ',
      'ເລກທີ ການເງິນ',
      'ເລກທີພະແນກ',
      'ລາຍການ',
      'ພາກສ່ວນ',
      'ເງິນກີບ',
      'ເງິນບາດ',
      'ເງິນໂດລາ',
      'ເງິນຢວນ',
      'ບັນຊີ',
      'ຫຼັກ',
      'ສຳຮອງ',
      'ໝາຍເຫດ',
    ]);
  });

  it('lays a document out under its group heading with the decision columns blank', () => {
    const g = grid(buildPayablesWorkbook([row()], OPTS));
    // Row 2 is the group heading (indented one column), row 3 the document.
    expect(g[2][1]).toBe('ພະແນກບໍລິຫານ');
    const r = g[3];
    expect(r[COL.index]).toBe(1);
    expect(r[COL.deptNo]).toBe('0004/ຈຊຈ/ບຫ');
    expect(r[COL.desc]).toBe('ຈັດຊື້ ຕິດຟີມລົດ');
    expect(r[COL.section]).toBe('ພະແນກບໍລິຫານ');
    expect(r[COL.LAK]).toBe(1000000);
    for (const c of [COL.finNo, 10, 11, 12, 13]) expect(r[c]).toBeUndefined();
  });

  it("writes the payee's bank in the bank column and leaves the rest of the decision columns blank", () => {
    const g = grid(buildPayablesWorkbook([row({ payeeBank: 'BCEL' })], OPTS));
    const r = g[3];
    expect(r[10]).toBe('BCEL');
    for (const c of [COL.finNo, 11, 12, 13]) expect(r[c]).toBeUndefined();
  });

  it('writes the submit date as a plain numeric serial with a date format, no time', () => {
    // A numeric serial + format is what Google Sheets and every Excel build render; the `t: 'd'`
    // ISO cell type came back as an empty column in Google Sheets.
    const buf = buildPayablesWorkbook(
      [row({ submittedAt: new Date(2026, 8, 15, 13, 45, 10) })],
      OPTS,
    );
    const wb = XLSX.read(buf, { type: 'buffer', cellNF: true });
    const cell = wb.Sheets[wb.SheetNames[0]].A4;
    expect(cell.t).toBe('n');
    expect(cell.z).toBe('dd/mm/yyyy');
    expect(cell.v).toBe(46280); // 2026-09-15 as days since 1899-12-30, a whole number
    expect(cell.w).toBe('15/09/2026');
  });

  it('renders the code fallback exactly as the caller shaped it', () => {
    const g = grid(
      buildPayablesWorkbook(
        [row({ typeAbbrev: 'PR', deptAbbrev: 'ADM' })],
        OPTS,
      ),
    );
    expect(g[3][COL.deptNo]).toBe('0004/PR/ADM');
  });

  it('puts a THB amount in the THB column only', () => {
    const g = grid(
      buildPayablesWorkbook(
        [row({ currencyCode: 'THB', grandTotal: '1500.00' })],
        OPTS,
      ),
    );
    const r = g[3];
    expect(r[COL.THB]).toBe(1500);
    expect(r[COL.LAK]).toBeUndefined();
    expect(r[COL.USD]).toBeUndefined();
    expect(r[COL.CNY]).toBeUndefined();
  });

  it('groups a child department under its root and subtotals the group', () => {
    const rows = [
      row({ docNo: 'A', runningNo: '0001', grandTotal: '1000000' }),
      row({
        docNo: 'B',
        runningNo: '0002',
        departmentName: 'ໜ່ວຍງານຈັດຊື້',
        deptAbbrev: 'ຈຊຈ',
        grandTotal: '250000',
      }),
    ];
    const g = grid(buildPayablesWorkbook(rows, OPTS));
    expect(g[2][1]).toBe('ພະແນກບໍລິຫານ (ໜ່ວຍງານຈັດຊື້)');
    expect(g[3][COL.index]).toBe(1);
    expect(g[4][COL.index]).toBe(2);
    // Subtotal, then the grand total, both per currency.
    expect(g[5][COL.section]).toBe('ລວມ');
    expect(g[5][COL.LAK]).toBe(1250000);
    expect(g[6][COL.section]).toBe('ລວມທັງໝົດ');
    expect(g[6][COL.LAK]).toBe(1250000);
  });

  it('never adds across currencies in a subtotal or the grand total', () => {
    const rows = [
      row({ docNo: 'A', currencyCode: 'LAK', grandTotal: '1000000' }),
      row({ docNo: 'B', currencyCode: 'USD', grandTotal: '120.50' }),
    ];
    const g = grid(buildPayablesWorkbook(rows, OPTS));
    const sub = g[5];
    expect(sub[COL.LAK]).toBe(1000000);
    expect(sub[COL.USD]).toBe(120.5);
    expect(sub[COL.THB]).toBeUndefined();
    const grand = g[6];
    expect(grand[COL.LAK]).toBe(1000000);
    expect(grand[COL.USD]).toBe(120.5);
  });

  it("orders groups by root code and keeps the rows' given order inside each", () => {
    const rows = [
      row({
        docNo: 'H1',
        runningNo: '0009',
        rootDeptCode: 'HR',
        rootDeptName: 'ບຸກຄະລາກອນ',
        departmentName: 'ບຸກຄະລາກອນ',
      }),
      row({ docNo: 'A2', runningNo: '0002' }),
      row({ docNo: 'A1', runningNo: '0001' }),
    ];
    const g = grid(buildPayablesWorkbook(rows, OPTS));
    expect(g[2][1]).toBe('ພະແນກບໍລິຫານ');
    expect(g[3][COL.deptNo]).toBe('0002/ຈຊຈ/ບຫ');
    expect(g[4][COL.deptNo]).toBe('0001/ຈຊຈ/ບຫ');
    expect(g[6][1]).toBe('ບຸກຄະລາກອນ');
    expect(g[7][COL.deptNo]).toBe('0009/ຈຊຈ/ບຫ');
    // Index keeps counting across groups.
    expect(g[7][COL.index]).toBe(3);
  });

  it('adds a column for a currency outside the fixed four, headed by its code', () => {
    const g = grid(
      buildPayablesWorkbook(
        [row({ currencyCode: 'EUR', grandTotal: '10.00' })],
        { ...OPTS, decimalPlaces: { ...OPTS.decimalPlaces, EUR: 2 } },
      ),
    );
    expect(g[HEADER][10]).toBe('EUR');
    expect(g[HEADER][11]).toBe('ບັນຊີ');
    expect(g[3][10]).toBe(10);
  });

  it('produces an empty sheet with headers and a zero-row grand total when nothing matches', () => {
    const g = grid(buildPayablesWorkbook([], OPTS));
    expect(g[HEADER][0]).toBe('ວັນທີ່ເອກະສານມາ');
    expect(g[2][COL.section]).toBe('ລວມທັງໝົດ');
  });
});
