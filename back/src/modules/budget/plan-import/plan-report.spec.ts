import { describe, expect, it } from 'vitest';
import { formatPlanReport, parsePlanArgs } from './plan-report';
import type { PlanImportResult } from './plan-import.service';

describe('plan import arguments', () => {
  it('takes a company, a year and a workbook', () => {
    expect(parsePlanArgs(['--company', 'HAL', '--fiscal-year', '2026', 'plan.xlsx'])).toEqual({
      companyCode: 'HAL',
      year: 2026,
      file: 'plan.xlsx',
      parentDeptCode: undefined,
      dryRun: false,
    });
  });

  it('accepts the = form and the short flags', () => {
    const a = parsePlanArgs(['--company=HAL', '--fiscal-year=2026', '--parent-dept=PLAN', 'p.xlsx']);
    expect(a).toMatchObject({ companyCode: 'HAL', year: 2026, parentDeptCode: 'PLAN' });
    expect(parsePlanArgs(['-c', 'HAL', '-y', '2026', 'p.xlsx']).year).toBe(2026);
  });

  it('takes --dry-run', () => {
    expect(parsePlanArgs(['-c', 'HAL', '-y', '2026', '--dry-run', 'p.xlsx']).dryRun).toBe(true);
  });

  it('refuses a run with no company or no year', () => {
    expect(() => parsePlanArgs(['-y', '2026', 'p.xlsx'])).toThrow(/company is required/i);
    expect(() => parsePlanArgs(['-c', 'HAL', 'p.xlsx'])).toThrow(/fiscal year is required/i);
  });

  it('refuses more than one workbook', () => {
    expect(() => parsePlanArgs(['-c', 'HAL', '-y', '2026', 'a.xlsx', 'b.xlsx'])).toThrow(/exactly one/i);
  });

  it('refuses an unknown option rather than reading it as a path', () => {
    expect(() => parsePlanArgs(['-c', 'HAL', '-y', '2026', '--dryrun', 'p.xlsx'])).toThrow(/unknown option/i);
  });
});

const result = (over: Partial<PlanImportResult> = {}): PlanImportResult => ({
  companyCode: 'HAL',
  year: 2026,
  dryRun: false,
  departmentsCreated: ['PLAN', '1'],
  mappingsCreated: ['PLAN'],
  nodesCreated: 3,
  budgetsCreated: 2,
  budgetsPlanned: 2,
  budgetsUnchanged: 0,
  budgetsTotal: '600',
  planDocumentIds: ['d1'],
  plan: {
    nodes: [
      { code: '1', name: 'Admin', departmentCode: '1', isDepartmentRoot: true },
      { code: '1.1', name: 'General', departmentCode: '1', parentCode: '1', isDepartmentRoot: false },
      { code: '2.1', name: 'Maybe', departmentCode: '2', parentCode: '2', isDepartmentRoot: false },
    ],
    budgets: [
      { code: '1.1', departmentCode: '1', amountTotal: '600', unbudgeted: false },
      { code: '2.1', departmentCode: '2', amountTotal: '0', unbudgeted: true, statedAmount: '500' },
    ],
    summaries: ['1'],
    duplicates: [
      { code: '3.1', keptName: 'Advertising', keptAmount: '1410000000', keptRow: 162,
        droppedName: 'Promotion', droppedAmount: '7492500000', droppedRow: 175 },
    ],
    conflicts: [
      { code: '12.1', name: 'ເຄຍຄະດີ', states: '5319600000', beneath: '22237031916', row: 400 },
    ],
    departments: [
      { departmentCode: '1', name: 'Admin', stated: '600', created: '600', agrees: true, unbudgeted: false },
      { departmentCode: '2', name: 'Contingency', stated: '500', created: '0', agrees: true, unbudgeted: true },
      { departmentCode: '3', name: 'Marketing', stated: '900', created: '800', agrees: false, unbudgeted: false },
    ],
    sectionCheck: { budgeted: '600', unbudgeted: '500', total: '1100' },
  },
  ...over,
});

describe('plan import report', () => {
  it('separates what it created from what was already there', () => {
    // The first cut reported the plan's size as "created", so a re-run that inserted nothing still
    // claimed 241 — the one run where the number matters most.
    const t = formatPlanReport(result({ budgetsCreated: 0, budgetsUnchanged: 241, budgetsPlanned: 241 }));
    expect(t).toMatch(/budgets created\s+0/);
    expect(t).toMatch(/already present, untouched\s+241/);
  });

  it('says plainly when nothing was written', () => {
    expect(formatPlanReport(result({ dryRun: true }))).toContain('DRY RUN');
  });

  it('shows the workbook own subtotals, which are the check on the whole read', () => {
    const t = formatPlanReport(result());
    expect(t).toContain('ມີງົບ');
    expect(t).toContain('ບໍ່ມີງົບ');
    expect(t).toContain('ທັງໝົດ');
  });

  it('names every row it created at zero, with what the workbook stated', () => {
    const t = formatPlanReport(result());
    expect(t).toContain('Created at ZERO');
    expect(t).toContain('2.1');
    expect(t).toContain('500');
  });

  it('names every row it left out, with both figures', () => {
    // A report of totals alone would read as complete success while 21 rows were withheld.
    const t = formatPlanReport(result());
    expect(t).toContain('NOT created');
    expect(t).toContain('12.1');
    expect(t).toContain('5,319,600,000');
    expect(t).toContain('22,237,031,916');
  });

  it('shows both rows of a duplicated code, kept and dropped', () => {
    const t = formatPlanReport(result());
    expect(t).toContain('Stated more than once');
    expect(t).toContain('row  162');
    expect(t).toContain('row  175');
    expect(t).toContain('Advertising');
    expect(t).toContain('Promotion');
  });

  it('marks a department that did not come out as intended', () => {
    const t = formatPlanReport(result());
    expect(t).toMatch(/!!\s+3/);
    expect(t).toContain('2 of 3 departments came out as intended');
  });

  it('does not mark an unbudgeted department that correctly created nothing', () => {
    const t = formatPlanReport(result());
    const line = t.split('\n').find((l) => l.includes('Contingency'))!;
    expect(line).not.toContain('!!');
    expect(line).toContain('unbudgeted');
  });
});
