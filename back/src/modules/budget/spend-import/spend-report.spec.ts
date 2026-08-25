import { describe, expect, it } from 'vitest';
import { formatSpendReport, parseSpendArgs } from './spend-report';
import type { SpendImportResult } from './spend-import.service';
import type { SpendPlan } from './spend-plan';

describe('spend import arguments', () => {
  it('takes the company, the year, the type and the workbook', () => {
    expect(
      parseSpendArgs(['--company', 'HAL', '--fiscal-year', '2026', '--dry-run', 'book.xlsx']),
    ).toEqual({
      companyCode: 'HAL',
      year: 2026,
      file: 'book.xlsx',
      docTypeCode: undefined,
      dryRun: true,
    });
    expect(parseSpendArgs(['-c', 'HAL', '-y', '2026', '--doc-type=HIST', 'b.xlsx']).docTypeCode).toBe(
      'HIST',
    );
  });

  it('refuses to run without a company or a fiscal year', () => {
    expect(() => parseSpendArgs(['--fiscal-year', '2026', 'b.xlsx'])).toThrow(/company is required/);
    expect(() => parseSpendArgs(['--company', 'HAL', 'b.xlsx'])).toThrow(/fiscal year is required/);
  });

  it('refuses an unknown option rather than reading it as the workbook', () => {
    expect(() => parseSpendArgs(['-c', 'HAL', '-y', '2026', '--dryrun', 'b.xlsx'])).toThrow(
      /Unknown option/,
    );
  });
});

const plan = (over: Partial<SpendPlan> = {}): SpendPlan => ({
  documents: [],
  chargedByCode: new Map([['7.301', '250000']]),
  skipped: [],
  crossDepartment: [],
  outsideFiscalYear: [],
  lineCount: 2,
  total: '250000',
  byQuarter: ['250000', '0', '0', '0'],
  byDepartment: new Map([['7', '250000']]),
  ...over,
});

const result = (over: Partial<SpendImportResult> = {}): SpendImportResult => ({
  companyCode: 'HAL',
  year: 2026,
  dryRun: false,
  documentsCreated: 1,
  documentsUnchanged: 0,
  linesCreated: 2,
  ledgerRows: 2,
  budgetsCreatedAtZero: [],
  controlPointsCreated: 0,
  descriptionsSupplied: 0,
  descriptionsTruncated: 0,
  plan: plan(),
  ...over,
});

describe('the spend import report', () => {
  it('says plainly when nothing was written', () => {
    expect(formatSpendReport(result({ dryRun: true }))).toContain('DRY RUN');
  });

  it('states the quarterly totals, which are what gets compared with their sheet', () => {
    const text = formatSpendReport(result());
    expect(text).toContain('By quarter');
    expect(text).toContain('250,000');
  });

  it('names every budget it created at zero, with what was charged to it', () => {
    const text = formatSpendReport(
      result({
        budgetsCreatedAtZero: [{ code: '7.502', departmentCode: '7', charged: '3675828099' }],
        controlPointsCreated: 1,
      }),
    );
    expect(text).toContain('7.502');
    expect(text).toContain('3,675,828,099');
    expect(text).toContain('overspending');
    expect(text).toContain('control points minted');
  });

  it('names every row it left out, and the money in them', () => {
    const text = formatSpendReport(
      result({
        plan: plan({
          skipped: [
            { row: 3569, reason: 'NO_MONTH', code: '1.601', description: 'ຄ່າເຊົ່າ', amount: '44850000' },
            { row: 4208, reason: 'NO_CODE', code: '', description: 'ຄ່າບໍລິການ', amount: '152645600' },
            { row: 900, reason: 'NO_AMOUNT', code: '7.301', description: 'ບໍ່ມີຍອດ' },
          ],
        }),
      }),
    );
    expect(text).toContain('row 3569');
    expect(text).toContain('month cannot be read');
    expect(text).toContain('names no plan code');
    expect(text).toContain('states no amount');
    // The money it is leaving out, stated once so it cannot be missed: 44,850,000 + 152,645,600.
    expect(text).toContain('197,495,600');
  });

  it('reports a re-run as having changed nothing', () => {
    const text = formatSpendReport(
      result({ documentsCreated: 0, documentsUnchanged: 1187, linesCreated: 0, ledgerRows: 0 }),
    );
    expect(text).toMatch(/documents\s+0/);
    expect(text).toMatch(/already present, untouched\s+1187/);
  });

  it('names the rows one department spent against another’s line', () => {
    const text = formatSpendReport(
      result({
        plan: plan({
          crossDepartment: [
            { sheetRow: 512, departmentCode: '6', code: '18.101', amount: '18571573' },
          ],
        }),
      }),
    );
    expect(text).toContain('row 512');
    expect(text).toContain('dept 6');
    expect(text).toContain('18.101');
  });
});
