import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readChartFile } from './workbook-reader';

/**
 * Read against the customer's own exports, not against a fixture built to pass.
 *
 * A reader tested only on a workbook this repo wrote proves the reader agrees with itself. These
 * two files are the ones the import exists for, and every count below was measured from them.
 */
const DATA = resolve(__dirname, '../../../../../data/account');
const PARENT_CHART = resolve(DATA, 'ບັນຊີ (3).xls');
const COMPANY_CHART = resolve(DATA, 'ສາລະບານບັນຊີ 2026 (3).xls');
const hasFiles = existsSync(PARENT_CHART) && existsSync(COMPANY_CHART);

describe.skipIf(!hasFiles)('chart workbook reader (customer files)', () => {
  it('reads the parent chart', () => {
    const rows = readChartFile(PARENT_CHART);
    expect(rows).toHaveLength(3341);
  });

  it('reads the company chart', () => {
    const rows = readChartFile(COMPANY_CHART);
    expect(rows).toHaveLength(742);
  });

  it('finds the header on a different row in each file', () => {
    // The whole reason the header is located rather than assumed: these two exports of the same
    // shape put it two rows apart. The first data row is what proves which row was found.
    expect(readChartFile(PARENT_CHART)[0].row).toBe(19);
    expect(readChartFile(COMPANY_CHART)[0].row).toBe(20);
  });

  it('takes the code, the name and the class word from the located columns', () => {
    const byCode = new Map(readChartFile(PARENT_CHART).map((r) => [r.code, r]));
    const root = byCode.get('1');
    expect(root?.klass).toBe('ຊັບສິນ');
    expect(root?.name).toContain('ຊັບສິນ');
    const leaf = byCode.get('1011.01');
    expect(leaf?.name).toBe('ເງິນສົດບໍລິການ');
    expect(leaf?.klass).toBe('ຊັບສິນ');
  });

  it('keeps an integer code as an integer, never as "1017.0"', () => {
    // Codes arrive as numbers for the short ones and strings for the dotted ones. A float
    // round-trip would turn the account `1017` into `1017.0` and orphan its six children.
    const codes = readChartFile(PARENT_CHART).map((r) => r.code);
    expect(codes).toContain('1017');
    expect(codes.some((c) => c.endsWith('.0'))).toBe(false);
  });

  it('strips the zero-width spaces the export embeds in Lao names', () => {
    const rows = readChartFile(PARENT_CHART);
    expect(rows.every((r) => !r.name.includes('​'))).toBe(true);
  });

  it('reads a name that spans the merged columns, not just the first cell', () => {
    const long = readChartFile(PARENT_CHART).find((r) => r.code === '2192');
    expect(long?.name.length).toBeGreaterThan(50);
  });

  it('names the file it read each row from', () => {
    expect(readChartFile(COMPANY_CHART).every((r) => r.file.includes('ສາລະບານບັນຊີ'))).toBe(true);
  });

  it('refuses a workbook with no locatable header', async () => {
    const XLSX = await import('xlsx');
    const { writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const path = resolve(tmpdir(), 'no-header-chart.xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['a', 'b'], ['1', 'x']]), 'S');
    writeFileSync(path, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
    try {
      expect(() => readChartFile(path)).toThrow(/no header row found/i);
    } finally {
      rmSync(path, { force: true });
    }
  });

  it('reads .xlsx as well as .xls', async () => {
    // The parent chart is BIFF and the budget workbook a later change needs is OOXML; one reader
    // has to take both, which is why `xlsx` was chosen over `exceljs`.
    const XLSX = await import('xlsx');
    const { writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const path = resolve(tmpdir(), 'mini-chart.xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['ບໍລິສັດ ຕົວຢ່າງ'],
        ['ລ/ດ', 'ເລກບັນຊີ', 'ຊື່ບັນຊີ ພາສາລາວ', 'ໝວດບັນຊີ'],
        [1, '1011', 'ເງິນສົດ', 'ຊັບສິນ'],
      ]),
      'S',
    );
    writeFileSync(path, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
    try {
      const rows = readChartFile(path);
      expect(rows).toEqual([
        { code: '1011', name: 'ເງິນສົດ', klass: 'ຊັບສິນ', file: 'mini-chart.xlsx', row: 3 },
      ]);
    } finally {
      rmSync(path, { force: true });
    }
  });
});

if (!hasFiles) {
  // eslint-disable-next-line no-console
  console.warn('[chart-import] customer chart files not present — skipping reader spec');
}
