import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { buildPendingSummaryWorkbook } from './pending-summary-workbook';
import type { PendingSummary, PendingSummaryRow } from './pending-summary.service';

function row(over: Partial<PendingSummaryRow> = {}): PendingSummaryRow {
  return {
    documentId: 'd1',
    docNo: 'REC-HAL-2026-0027',
    documentType: { id: 't1', code: 'REC', name: 'ໃບເບີກຈ່າຍ' },
    department: { id: 'adm', deptCode: 'ADM', name: 'ພະແນກບໍລິຫານ' },
    requesterName: 'ນາງ ພອນສະຫວັນ',
    submittedAt: new Date(2026, 8, 11, 9, 30),
    waitingDays: 7,
    currentStepNo: 2,
    stepName: 'ຜູ້ອຳນວຍການ',
    waitingOn: [{ userId: 'u1', name: 'Sisavanh' }],
    currencyCode: 'LAK',
    grandTotal: '70000000.00',
    slaDueAt: null,
    overdue: false,
    ...over,
  };
}

function summary(rows: PendingSummaryRow[], over: Partial<PendingSummary> = {}): PendingSummary {
  return {
    rows,
    facets: { departments: [], documentTypes: [] },
    byDepartment: [
      { id: 'adm', deptCode: 'ADM', name: 'ພະແນກບໍລິຫານ', pendingCount: rows.length, oldestWaitingDays: 7, totals: { LAK: '70000000.00' } },
    ],
    byStep: [{ stepNo: 2, stepName: 'ຜູ້ອຳນວຍການ', pendingCount: rows.length, oldestWaitingDays: 7 }],
    byApprover: [{ userId: 'u1', name: 'Sisavanh', pendingCount: rows.length, oldestWaitingDays: 7 }],
    totals: { pendingCount: rows.length, overdueCount: 0, amounts: { LAK: '70000000.00' } },
    meta: {
      companyCode: 'HAL',
      companyName: 'Hal Logistic',
      baseCurrency: 'LAK',
      today: '2026-09-18',
      departmentName: null,
      submittedFrom: null,
      submittedTo: null,
      decimalPlaces: { LAK: 0, THB: 2, USD: 2, CNY: 2 },
    },
    ...over,
  };
}

function grid(buf: Buffer): unknown[][] {
  const wb = XLSX.read(buf, { type: 'buffer', cellNF: true });
  return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: undefined });
}

/** The row index of the first cell in column A equal to `label`. */
function rowOf(g: unknown[][], label: string): number {
  const i = g.findIndex((r) => r[0] === label);
  if (i < 0) throw new Error(`no row labelled ${label}`);
  return i;
}

describe('buildPendingSummaryWorkbook', () => {
  it('opens with the title and the four header lines, defaulting the period and the department', () => {
    const g = grid(buildPendingSummaryWorkbook(summary([row()])));
    expect(g[0][0]).toBe('ສະຫຼຸບເອກະສານຄ້າງອະນຸມັດ');
    expect(g[1]).toEqual(['ບໍລິສັດ', 'Hal Logistic']);
    expect(g[2]).toEqual(['ພະແນກ', 'ທຸກພະແນກ']);
    expect(g[3]).toEqual(['ໄລຍະເວລາສົ່ງ', 'ທັງໝົດທີ່ຍັງຄ້າງ']);
    expect(g[4]).toEqual(['ວັນທີອອກລາຍງານ', '2026-09-18']);
  });

  it('names the department and the week when the summary was filtered', () => {
    const g = grid(buildPendingSummaryWorkbook(summary([row()], {
      meta: { ...summary([]).meta, departmentName: 'ພະແນກບໍລິຫານ', submittedFrom: '2026-09-14', submittedTo: '2026-09-20' },
    })));
    expect(g[2][1]).toBe('ພະແນກບໍລິຫານ');
    expect(g[3][1]).toBe('2026-09-14 – 2026-09-20');
  });

  it('writes the three roll-up blocks and the totals line with money per currency', () => {
    const g = grid(buildPendingSummaryWorkbook(summary([row()])));
    const dept = rowOf(g, 'ຕາມພະແນກ');
    expect(g[dept].slice(0, 7)).toEqual(['ຕາມພະແນກ', 'ຈຳນວນ', 'ຄ້າງດົນສຸດ (ວັນ)', 'LAK', 'THB', 'USD', 'CNY']);
    expect(g[dept + 1].slice(0, 4)).toEqual(['ADM · ພະແນກບໍລິຫານ', 1, 7, 70000000]);
    const step = rowOf(g, 'ຕາມຂັ້ນຕອນ');
    expect(g[step + 1].slice(0, 3)).toEqual(['2 · ຜູ້ອຳນວຍການ', 1, 7]);
    const appr = rowOf(g, 'ຕາມຜູ້ອະນຸມັດທີ່ຄ້າງ');
    expect(g[appr + 1].slice(0, 3)).toEqual(['Sisavanh', 1, 7]);
    const total = rowOf(g, 'ລວມທັງໝົດ');
    expect(g[total].slice(0, 4)).toEqual(['ລວມທັງໝົດ', 1, 'ເກີນ SLA: 0', 70000000]);
  });

  it('lays the detail out under Lao headers with a date serial, the amount in its own column, and a blank remark', () => {
    const g = grid(buildPendingSummaryWorkbook(summary([row({ overdue: true })])));
    const head = rowOf(g, 'ລ/ດ');
    expect(g[head]).toEqual([
      'ລ/ດ', 'ເລກທີເອກະສານ', 'ປະເພດ', 'ຜູ້ສະເໜີ', 'ພະແນກ', 'ວັນທີສົ່ງ', 'ຄ້າງ (ວັນ)', 'ຂັ້ນຕອນປັດຈຸບັນ', 'ລໍຖ້າຜູ້ອະນຸມັດ',
      'LAK', 'THB', 'USD', 'CNY', 'SLA', 'ໝາຍເຫດ',
    ]);
    const r = g[head + 1];
    expect(r.slice(0, 5)).toEqual([1, 'REC-HAL-2026-0027', 'ໃບເບີກຈ່າຍ', 'ນາງ ພອນສະຫວັນ', 'ພະແນກບໍລິຫານ']);
    expect(r[5]).toBe(46276); // 2026-09-11 as an Excel serial — a number every viewer renders
    expect(r[6]).toBe(7);
    expect(r[7]).toBe('2 · ຜູ້ອຳນວຍການ');
    expect(r[8]).toBe('Sisavanh');
    expect(r[9]).toBe(70000000);
    expect(r[10]).toBeUndefined();
    expect(r[13]).toBe('ເກີນກຳນົດ');
    expect(r[14]).toBeUndefined();
  });

  it('keeps the rows in the order given and never mixes currencies in a column', () => {
    const rows = [
      row({ docNo: 'A', waitingDays: 20, currencyCode: 'USD', grandTotal: '120.50' }),
      row({ docNo: 'B', waitingDays: 12 }),
      row({ docNo: 'C', waitingDays: 3, currencyCode: 'THB', grandTotal: '1500.00' }),
    ];
    const g = grid(buildPendingSummaryWorkbook(summary(rows)));
    const head = rowOf(g, 'ລ/ດ');
    expect([g[head + 1][1], g[head + 2][1], g[head + 3][1]]).toEqual(['A', 'B', 'C']);
    expect(g[head + 1][11]).toBe(120.5);
    expect(g[head + 1][9]).toBeUndefined();
    expect(g[head + 3][10]).toBe(1500);
  });

  it('adds a column for a currency outside the fixed four', () => {
    const g = grid(buildPendingSummaryWorkbook(summary([row({ currencyCode: 'EUR', grandTotal: '9.99' })], {
      meta: { ...summary([]).meta, decimalPlaces: { LAK: 0, EUR: 2 } },
    })));
    const head = rowOf(g, 'ລ/ດ');
    expect(g[head][13]).toBe('EUR');
    expect(g[head][14]).toBe('SLA');
    expect(g[head + 1][13]).toBe(9.99);
  });
});
