import * as XLSX from 'xlsx';
import { Decimal } from 'decimal.js';
import type { AmountsByCurrency, PendingSummary } from './pending-summary.service';

/**
 * The department's weekly sheet for its head: what is still waiting, where, on whom, for how
 * long. One sheet — header lines, the roll-ups the head reads first, then the detail with the
 * longest wait at the top. Pure: takes the computed summary, returns bytes.
 *
 * Same rules as the payables sheet: money is a decimal string until the cell object is built,
 * dates are numeric Excel serials (the `t: 'd'` cell type renders empty in Google Sheets), and no
 * total ever adds across currencies.
 */

const FIXED_CURRENCIES = ['LAK', 'THB', 'USD', 'CNY'] as const;

const DETAIL_HEAD_BEFORE = [
  'ລ/ດ',
  'ເລກທີເອກະສານ',
  'ປະເພດ',
  'ຜູ້ສະເໜີ',
  'ພະແນກ',
  'ວັນທີສົ່ງ',
  'ຄ້າງ (ວັນ)',
  'ຂັ້ນຕອນປັດຈຸບັນ',
  'ລໍຖ້າຜູ້ອະນຸມັດ',
];
const DETAIL_HEAD_AFTER = ['SLA', 'ໝາຍເຫດ'];

type Cell = XLSX.CellObject | null;

const text = (v: string): XLSX.CellObject => ({ t: 's', v });
const num = (v: number): XLSX.CellObject => ({ t: 'n', v });
const blanks = (n: number): Cell[] => Array.from({ length: Math.max(0, n) }, () => null);

function numberFormat(places: number): string {
  return places > 0 ? `#,##0.${'0'.repeat(places)}` : '#,##0';
}

function moneyCell(amount: string, places: number): XLSX.CellObject {
  return { t: 'n', v: Number(new Decimal(amount).toFixed(places)), z: numberFormat(places) };
}

/** Excel serial for the calendar day of `d` (local), with a date format — readable everywhere. */
function dateCell(d: Date): XLSX.CellObject {
  const day = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return { t: 'n', v: (day - Date.UTC(1899, 11, 30)) / 86_400_000, z: 'dd/mm/yyyy' };
}

export function buildPendingSummaryWorkbook(summary: PendingSummary): Buffer {
  const currencies = currencyColumns(summary);
  const places = (code: string) => summary.meta.decimalPlaces[code] ?? 2;
  const amountCells = (amounts: AmountsByCurrency): Cell[] =>
    currencies.map((code) => (amounts[code] === undefined ? null : moneyCell(amounts[code], places(code))));
  const width = DETAIL_HEAD_BEFORE.length + currencies.length + DETAIL_HEAD_AFTER.length;

  const rows: Cell[][] = [];
  const merges: XLSX.Range[] = [];
  const line = (cells: Cell[]) => rows.push([...cells, ...blanks(width - cells.length)]);
  const mergeLast = (from = 0) =>
    merges.push({ s: { r: rows.length - 1, c: from }, e: { r: rows.length - 1, c: width - 1 } });

  // Header: who, for whom, for when, as of when.
  line([text('ສະຫຼຸບເອກະສານຄ້າງອະນຸມັດ')]);
  mergeLast();
  line([text('ບໍລິສັດ'), text(summary.meta.companyName || summary.meta.companyCode)]);
  line([text('ພະແນກ'), text(summary.meta.departmentName ?? 'ທຸກພະແນກ')]);
  line([text('ໄລຍະເວລາສົ່ງ'), text(periodText(summary.meta.submittedFrom, summary.meta.submittedTo))]);
  line([text('ວັນທີອອກລາຍງານ'), text(summary.meta.today)]);
  line([]);

  // Roll-ups: by department (with money), by step, by approver, then the totals.
  line([text('ຕາມພະແນກ'), text('ຈຳນວນ'), text('ຄ້າງດົນສຸດ (ວັນ)'), ...currencies.map(text)]);
  for (const d of summary.byDepartment) {
    line([text(`${d.deptCode} · ${d.name}`), num(d.pendingCount), d.oldestWaitingDays == null ? null : num(d.oldestWaitingDays), ...amountCells(d.totals)]);
  }
  line([]);
  line([text('ຕາມຂັ້ນຕອນ'), text('ຈຳນວນ'), text('ຄ້າງດົນສຸດ (ວັນ)')]);
  for (const s of summary.byStep) {
    line([text(`${s.stepNo}${s.stepName ? ' · ' + s.stepName : ''}`), num(s.pendingCount), s.oldestWaitingDays == null ? null : num(s.oldestWaitingDays)]);
  }
  line([]);
  line([text('ຕາມຜູ້ອະນຸມັດທີ່ຄ້າງ'), text('ຈຳນວນ'), text('ຄ້າງດົນສຸດ (ວັນ)')]);
  for (const a of summary.byApprover) {
    line([text(a.name), num(a.pendingCount), a.oldestWaitingDays == null ? null : num(a.oldestWaitingDays)]);
  }
  line([]);
  line([text('ລວມທັງໝົດ'), num(summary.totals.pendingCount), text(`ເກີນ SLA: ${summary.totals.overdueCount}`), ...amountCells(summary.totals.amounts)]);
  line([]);

  // Detail, longest wait first (the service orders it).
  line([...DETAIL_HEAD_BEFORE.map(text), ...currencies.map(text), ...DETAIL_HEAD_AFTER.map(text)]);
  summary.rows.forEach((r, i) => {
    const amounts: Cell[] = currencies.map((code) => (code === r.currencyCode ? moneyCell(r.grandTotal, places(code)) : null));
    line([
      num(i + 1),
      text(r.docNo),
      text(r.documentType.name),
      text(r.requesterName),
      text(r.department.name),
      r.submittedAt ? dateCell(r.submittedAt) : null,
      r.waitingDays == null ? null : num(r.waitingDays),
      text(`${r.currentStepNo}${r.stepName ? ' · ' + r.stepName : ''}`),
      text(r.waitingOn.map((a) => a.name).join(', ')),
      ...amounts,
      text(r.overdue ? 'ເກີນກຳນົດ' : r.slaDueAt ? 'ໃນກຳນົດ' : ''),
      null, // ໝາຍເຫດ — the head's
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!merges'] = merges;
  ws['!cols'] = [
    { wch: 22 }, { wch: 22 }, { wch: 18 }, { wch: 24 }, { wch: 22 }, { wch: 12 }, { wch: 10 }, { wch: 22 }, { wch: 28 },
    ...currencies.map(() => ({ wch: 16 })),
    { wch: 12 }, { wch: 24 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function periodText(from: string | null, to: string | null): string {
  if (!from && !to) return 'ທັງໝົດທີ່ຍັງຄ້າງ';
  return `${from ?? '…'} – ${to ?? '…'}`;
}

/** The fixed four, then any other currency present anywhere in the summary, alphabetically. */
function currencyColumns(summary: PendingSummary): string[] {
  const fixed = new Set<string>(FIXED_CURRENCIES);
  const present = new Set<string>(summary.rows.map((r) => r.currencyCode));
  const extra = [...present].filter((c) => !fixed.has(c)).sort();
  return [...FIXED_CURRENCIES, ...extra];
}
