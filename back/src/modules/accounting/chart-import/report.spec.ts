import { describe, expect, it } from 'vitest';
import { AccountType } from '../../../common/enums';
import { formatImportReport, parseImportArgs } from './report';
import type { ImportResult } from './chart-import.service';

describe('import arguments', () => {
  it('takes a company and files', () => {
    expect(parseImportArgs(['--company', 'HAL', 'a.xls', 'b.xlsx'])).toEqual({
      companyCode: 'HAL',
      files: ['a.xls', 'b.xlsx'],
      dryRun: false,
    });
  });

  it('accepts --company=CODE and -c', () => {
    expect(parseImportArgs(['--company=HAL', 'a.xls']).companyCode).toBe('HAL');
    expect(parseImportArgs(['-c', 'HAL', 'a.xls']).companyCode).toBe('HAL');
  });

  it('takes --dry-run', () => {
    expect(parseImportArgs(['--company', 'HAL', '--dry-run', 'a.xls']).dryRun).toBe(true);
  });

  it('refuses a run with no company, however few exist', () => {
    expect(() => parseImportArgs(['a.xls'])).toThrow(/company is required/i);
  });

  it('refuses a run with no files', () => {
    expect(() => parseImportArgs(['--company', 'HAL'])).toThrow(/at least one chart file/i);
  });

  it('refuses an option it does not know rather than reading it as a filename', () => {
    // `--dryrun a.xls` must not quietly import for real with a file called `--dryrun`.
    expect(() => parseImportArgs(['--company', 'HAL', '--dryrun', 'a.xls'])).toThrow(/unknown option/i);
  });
});

const result = (over: Partial<ImportResult> = {}): ImportResult => ({
  companyCode: 'HAL',
  companyId: 'c1',
  dryRun: false,
  created: 2,
  unchanged: 0,
  unchangedCodes: [],
  plan: {
    accounts: [
      { code: '1', name: 'Assets', accountType: AccountType.ASSET, isPostable: false },
      { code: '1011', name: 'Cash', accountType: AccountType.ASSET, parentCode: '1', isPostable: true },
    ],
    skipped: [{ code: '5', klass: 'ອື່ນໆ', file: 'f.xls', row: 20, reason: 'no ancestor states one' }],
    crossType: [
      { code: '752.01', accountType: AccountType.ASSET, parentCode: '752', parentType: AccountType.REVENUE },
    ],
    roots: ['1'],
  },
  ...over,
});

describe('import report', () => {
  it('says plainly when nothing was written', () => {
    expect(formatImportReport(result({ dryRun: true }))).toContain('DRY RUN');
  });

  it('names every skipped row, so dropped accounts cannot pass as success', () => {
    const text = formatImportReport(result());
    expect(text).toContain('Skipped');
    expect(text).toContain('5');
    expect(text).toContain('no ancestor states one');
    expect(text).toContain('f.xls row 20');
  });

  it('reports the contra accounts it kept', () => {
    const text = formatImportReport(result());
    expect(text).toContain('752.01');
    expect(text).toContain('under 752');
  });

  it('reports a type taken from an ancestor', () => {
    const r = result();
    r.plan.accounts[1].typeFromAncestor = '1';
    expect(formatImportReport(r)).toMatch(/ASSET from 1/);
  });

  it('reports a row that had no name of its own', () => {
    const r = result();
    r.plan.accounts[1].namedByCode = true;
    expect(formatImportReport(r)).toContain('Carried no name');
  });

  it('counts headers and lists the roots', () => {
    const text = formatImportReport(result());
    expect(text).toMatch(/headers \(not postable\)\s+1/);
    expect(text).toMatch(/roots\s+1/);
  });
});
