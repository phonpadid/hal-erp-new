import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { budgetsToCreate, departmentOf, planSpendImport } from './spend-plan';
import { readSpendFile, type SpendRow } from './spend-reader';

const WORKBOOK = resolve(
  __dirname,
  '../../../../../data/budget/8ໂມງ48-16-6- 2026 Monitoring budgetplan 2026 30-6-2026 (5).xlsx',
);
const hasFile = existsSync(WORKBOOK);

const row = (over: Partial<SpendRow> = {}): SpendRow => ({
  day: 3,
  month: 3,
  year: 2026,
  departmentCode: '7',
  code: '7.301',
  description: 'ຄ່າຈ້າງແຮງງານລາຍວັນ',
  amount: '12500000',
  row: 10,
  ...over,
});

describe('spend grouping: the grain', () => {
  it('puts a month of spending on one budget into one document, with a line each', () => {
    const plan = planSpendImport([
      row({ amount: '12500000', description: 'a', row: 10 }),
      row({ amount: '8400000', description: 'b', row: 11 }),
      row({ amount: '3200000', description: 'c', row: 12 }),
    ]);
    expect(plan.documents.length).toBe(1);
    expect(plan.documents[0].amount).toBe('24100000');
    expect(plan.documents[0].lines.map((l) => l.description)).toEqual(['a', 'b', 'c']);
    expect(plan.documents[0].date).toBe('2026-03-01');
  });

  it('does not let two months of one budget share a document', () => {
    const plan = planSpendImport([row({ month: 3 }), row({ month: 4 })]);
    expect(plan.documents.length).toBe(2);
    expect(plan.documents.map((d) => d.date)).toEqual(['2026-03-01', '2026-04-01']);
  });

  it('keeps the sheet’s own running number on the line it became', () => {
    const plan = planSpendImport([row({ sequence: '03498' })]);
    expect(plan.documents[0].lines[0].sequence).toBe('03498');
    expect(plan.documents[0].lines[0].spentOn).toBe('2026-03-03');
  });

  it('gives one budget and month one source id, so a re-run finds the document again', () => {
    const plan = planSpendImport([row({ row: 10 }), row({ row: 11 })]);
    expect(plan.documents[0].sourceId).toBe('7.301:2026-03');
  });
});

describe('spend grouping: which budget is charged', () => {
  it('takes the budget from the plan code when the department column disagrees', () => {
    // Department 6 paying for the HAL PAY server, which is department 18's line.
    const plan = planSpendImport([row({ departmentCode: '6', code: '18.101', amount: '18571573' })]);
    expect(plan.documents[0].code).toBe('18.101');
    expect(plan.documents[0].departmentCode).toBe('6');
    expect(departmentOf(plan.documents[0].code)).toBe('18');
    expect([...plan.byDepartment.keys()]).toEqual(['18']);
    expect(plan.crossDepartment.length).toBe(1);
  });

  it('charges a plan code pasted into the department column once, not twice', () => {
    const plan = planSpendImport([
      row({ departmentCode: '12.113', code: '12.113', amount: '1287139980' }),
    ]);
    expect(plan.documents.length).toBe(1);
    expect(plan.chargedByCode.get('12.113')).toBe('1287139980');
  });

  it('names only the codes it charged as needing a budget', () => {
    const plan = planSpendImport([row({ code: '7.301' }), row({ code: '7.502' })]);
    expect(budgetsToCreate(plan, new Set(['7.301', '9.101']))).toEqual(['7.502']);
  });
});

describe.skipIf(!hasFile)('spend grouping: against the customer’s own sheet', () => {
  const { rows, skipped } = readSpendFile(WORKBOOK);
  const plan = planSpendImport(rows, skipped);

  it('produces 1,187 documents carrying 5,689 lines', () => {
    expect(plan.documents.length).toBe(1187);
    expect(plan.lineCount).toBe(5689);
    expect(plan.documents.reduce((s, d) => s + d.lines.length, 0)).toBe(5689);
  });

  it('charges 317 plan codes, totalling 221,259,490,412', () => {
    expect(plan.chargedByCode.size).toBe(317);
    expect(plan.total).toBe('221259490412');
    const summed = [...plan.chargedByCode.values()].reduce((s, v) => s + BigInt(v), 0n);
    expect(summed.toString()).toBe(plan.total);
  });

  it('reproduces the quarterly totals the customer states', () => {
    expect(plan.byQuarter).toEqual(['97205850640', '90365434886', '33688204886', '0']);
    const summed = plan.byQuarter.reduce((s, v) => s + BigInt(v), 0n);
    expect(summed.toString()).toBe(plan.total);
  });

  it('finds the 16 rows whose department column is not their code’s department', () => {
    expect(plan.crossDepartment.length).toBe(16);
    // Every one of them still charges the budget its CODE names.
    for (const r of plan.crossDepartment) {
      const doc = plan.documents.find((d) => d.lines.some((l) => l.sheetRow === r.sheetRow))!;
      expect(doc.code).toBe(r.code);
    }
  });

  it('carries every kip into a department', () => {
    const summed = [...plan.byDepartment.values()].reduce((s, v) => s + BigInt(v), 0n);
    expect(summed.toString()).toBe(plan.total);
  });
});
