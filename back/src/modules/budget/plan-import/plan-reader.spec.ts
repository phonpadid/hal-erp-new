import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPlanFile } from './plan-reader';

/**
 * Read against the customer's own workbook. Every figure below was measured from it before this
 * code existed, so a passing run means the reader agrees with the spreadsheet, not with itself.
 */
const WORKBOOK = resolve(
  __dirname,
  '../../../../../data/budget/8ໂມງ48-16-6- 2026 Monitoring budgetplan 2026 30-6-2026 (5).xlsx',
);
const has = existsSync(WORKBOOK);

describe.skipIf(!has)('budget plan reader (customer workbook)', () => {
  const read = () => readPlanFile(WORKBOOK);
  const rows = () => read().rows;

  it('reads every plan line it can read', () => {
    expect(rows()).toHaveLength(553);
  });

  it('reports the rows it could not read instead of dropping them', () => {
    // Four of them, and only one is junk: `8.10900000000001`, a float artifact with no name and no
    // amount. The other three are the file's OWN totals — `ລວມ ຍອດ ມີງົບ`, `ບໍ່ມີງົບ` and
    // `ທັງໝົດ` — which is how the plan's two sections were found at all. Dropping unreadable rows
    // in silence would have hidden the split that decides whether 16 billion kip is spendable.
    const { ignored } = read();
    expect(ignored).toHaveLength(4);
    expect(ignored.map((i) => i.raw)).toContain('8.10900000000001');
    expect(ignored.filter((i) => i.raw.includes('ລວມ ຍອດ'))).toHaveLength(3);
  });

  it('finds 552 distinct codes, one of them stated twice', () => {
    const codes = rows().map((r) => r.code);
    expect(new Set(codes).size).toBe(552);
    const twice = codes.filter((c, i) => codes.indexOf(c) !== i);
    expect(twice).toEqual(['3.1']);
  });

  it('reads the 2026 column, not a prior year', () => {
    // `ງົບປະມານ/2024` and `/2025` sit immediately left of it. Reading one column over would import
    // the wrong year's plan with every count still looking right — department 1 is the tell:
    // 2024 is 28,094,900,000 and 2026 is 24,902,012,368.
    const byCode = new Map(rows().map((r) => [r.code, r]));
    expect(byCode.get('1')?.amount).toBe('24902012368');
    expect(byCode.get('1.1')?.amount).toBe('534000000');
    expect(byCode.get('1.101')?.amount).toBe('350000000');
  });

  it('counts the rows that carry an amount', () => {
    // 314 ROWS but 313 distinct codes: `3.1` is stated twice and both statements carry money.
    expect(rows().filter((r) => r.amount).length).toBe(314);
    expect(new Set(rows().filter((r) => r.amount).map((r) => r.code)).size).toBe(313);
  });

  it('sums the departments to the plan total', () => {
    const depts = rows().filter((r) => !r.code.includes('.') && r.amount);
    const total = depts.reduce((s, r) => s + BigInt(r.amount!), 0n);
    expect(total.toString()).toBe('413619804355');
  });

  it('carries amounts as strings of whole kip, never as JS numbers', () => {
    // Several cells are fractions of a kip out of a spreadsheet division; they are rounded once,
    // in the reader, where the rounding is visible rather than discovered later in a total.
    for (const r of rows()) {
      if (!r.amount) continue;
      expect(typeof r.amount).toBe('string');
      expect(r.amount).toMatch(/^\d+$/);
    }
  });

  it('leaves an empty or zero cell without an amount', () => {
    const byCode = new Map(rows().map((r) => [r.code, r]));
    expect(byCode.get('9')?.amount).toBeUndefined();
    expect(byCode.get('13')?.amount).toBeUndefined();
  });

  it('keeps the plan names', () => {
    const byCode = new Map(rows().map((r) => [r.code, r]));
    expect(byCode.get('1')?.name).toContain('ບໍລິຫານ');
    expect(byCode.get('7')?.name).toContain('ຂົນສົ່ງ');
  });

  it('reads all 20 departments', () => {
    const depts = rows().filter((r) => !r.code.includes('.')).map((r) => r.code);
    expect(depts.sort((a, b) => Number(a) - Number(b))).toEqual(
      Array.from({ length: 20 }, (_, i) => String(i + 1)),
    );
  });

  it('refuses a sheet with no plan header', async () => {
    const XLSX = await import('xlsx');
    const { writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const path = resolve(tmpdir(), 'no-plan-header.xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['a'], ['1']]), 'S');
    writeFileSync(path, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
    try {
      expect(() => readPlanFile(path)).toThrow(/no plan header row found/i);
    } finally {
      rmSync(path, { force: true });
    }
  });
});

if (!has) {
  // eslint-disable-next-line no-console
  console.warn('[plan-import] customer workbook not present — skipping reader spec');
}
