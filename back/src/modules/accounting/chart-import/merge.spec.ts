import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AccountType } from '../../../common/enums';
import { ChartCollisionError, codePrefixes, planChart } from './merge';
import { readChartFile } from './workbook-reader';
import type { SourceAccount } from './workbook-reader';

const DATA = resolve(__dirname, '../../../../../data/account');
const PARENT_CHART = resolve(DATA, 'ບັນຊີ (3).xls');
const COMPANY_CHART = resolve(DATA, 'ສາລະບານບັນຊີ 2026 (3).xls');
const hasFiles = existsSync(PARENT_CHART) && existsSync(COMPANY_CHART);

const src = (code: string, klass = 'ຊັບສິນ', name = `n-${code}`): SourceAccount => ({
  code,
  name,
  klass,
  file: 'test.xlsx',
  row: 1,
});

// ---- The rule, on its own ------------------------------------------------------------------

describe('code prefixes', () => {
  it('offers the dotted head first, then shorter digit prefixes', () => {
    expect(codePrefixes('1213110.20')).toEqual(['1213110', '121311', '12131', '1213', '121', '12', '1']);
  });

  it('offers only digit prefixes for an undotted code', () => {
    expect(codePrefixes('1011')).toEqual(['101', '10', '1']);
  });

  it('offers nothing for a single digit', () => {
    expect(codePrefixes('1')).toEqual([]);
  });
});

describe('hierarchy derivation', () => {
  it('takes the NEAREST existing ancestor, not the first or the shortest', () => {
    // `1213110` is absent, so the parent is `1213` — the longest prefix that is really there.
    const plan = planChart([src('1'), src('12'), src('1213'), src('1213110.20')]);
    const byCode = new Map(plan.accounts.map((a) => [a.code, a]));
    expect(byCode.get('1213110.20')?.parentCode).toBe('1213');
    expect(byCode.get('1213')?.parentCode).toBe('12');
    expect(byCode.get('12')?.parentCode).toBe('1');
    expect(byCode.get('1')?.parentCode).toBeUndefined();
  });

  it('does not read a separator position as depth', () => {
    // Two codes of equal length differing only in where the dot falls. Neither is a prefix of the
    // other, so neither may become the other's parent — the trap the budget plan fell into, where
    // `1.1` is a category and `1.101` a line and both carry one dot.
    const plan = planChart([src('11.1'), src('1.11')]);
    expect(plan.accounts.every((a) => a.parentCode === undefined)).toBe(true);
  });

  it('does not make an account its own parent', () => {
    const plan = planChart([src('1011')]);
    expect(plan.accounts[0].parentCode).toBeUndefined();
  });
});

describe('postability derivation', () => {
  it('marks a node with children as a header and its children as postable', () => {
    const plan = planChart([src('1017'), src('1017.0001'), src('1017.0002')]);
    const byCode = new Map(plan.accounts.map((a) => [a.code, a]));
    expect(byCode.get('1017')?.isPostable).toBe(false);
    expect(byCode.get('1017.0001')?.isPostable).toBe(true);
    expect(byCode.get('1017.0002')?.isPostable).toBe(true);
  });

  it('marks a childless account postable even when it is a class head', () => {
    const plan = planChart([src('9')]);
    expect(plan.accounts[0].isPostable).toBe(true);
  });
});

describe('type derivation', () => {
  it('uses the row own class when the system holds it', () => {
    const plan = planChart([src('6', 'ລາຍຈ່າຍ')]);
    expect(plan.accounts[0].accountType).toBe(AccountType.EXPENSE);
  });

  it('takes the nearest typed ancestor when the class is one we do not hold', () => {
    const plan = planChart([src('1', 'ຊັບສິນ'), src('1027', 'ຊັບສິນ'), src('1027.020', 'ອື່ນໆ')]);
    const odd = plan.accounts.find((a) => a.code === '1027.020');
    expect(odd?.accountType).toBe(AccountType.ASSET);
    expect(odd?.typeFromAncestor).toBe('1027');
    expect(plan.skipped).toHaveLength(0);
  });

  it('walks PAST an ancestor that is also untyped', () => {
    const plan = planChart([src('4', 'ໜີ້ສິນ'), src('4218', 'ອື່ນໆ'), src('4218.01', 'ອື່ນໆ')]);
    const leaf = plan.accounts.find((a) => a.code === '4218.01');
    expect(leaf?.accountType).toBe(AccountType.LIABILITY);
    expect(leaf?.typeFromAncestor).toBe('4');
  });

  it('skips a row whose ancestors are untyped too, and says why', () => {
    const plan = planChart([src('5', 'ອື່ນໆ'), src('51', 'ອື່ນໆ')]);
    expect(plan.accounts).toHaveLength(0);
    expect(plan.skipped.map((s) => s.code).sort()).toEqual(['5', '51']);
    expect(plan.skipped[0].reason).toMatch(/not one this system holds/);
  });

  it('re-parents a survivor around a skipped ancestor rather than orphaning it', () => {
    // A skipped account must not be left as somebody's parent — that would be a code pointing at
    // a row that was never written. The only way to reach a skipped ancestor is a chain that is
    // untyped all the way up, which is exactly the shape of their class 5.
    const plan = planChart([src('5', 'ອື່ນໆ'), src('51', 'ອື່ນໆ'), src('51.1', 'ຊັບສິນ')]);
    expect(plan.skipped.map((s) => s.code).sort()).toEqual(['5', '51']);
    const survivor = plan.accounts.find((a) => a.code === '51.1');
    expect(survivor).toBeDefined();
    expect(survivor?.parentCode).toBeUndefined();
  });

  it('a typed row under an untyped one keeps the untyped row as its parent when that row survives', () => {
    // The contrast to the test above: `15` has no class of its own but `1` gives it one, so it is
    // written and stays in the chain rather than being walked past.
    const plan = planChart([src('1', 'ຊັບສິນ'), src('15', 'ອື່ນໆ'), src('15.1', 'ຊັບສິນ')]);
    expect(plan.skipped).toHaveLength(0);
    expect(plan.accounts.find((a) => a.code === '15.1')?.parentCode).toBe('15');
  });

  it('stands a code in for a missing name, and flags that it did', () => {
    const plan = planChart([src('659222', 'ລາຍຈ່າຍ', '')]);
    expect(plan.accounts[0].name).toBe('659222');
    expect(plan.accounts[0].namedByCode).toBe(true);
  });
});

describe('merging files', () => {
  it('accepts the same code twice when both files agree', () => {
    const plan = planChart([src('1011'), { ...src('1011'), file: 'other.xls' }]);
    expect(plan.accounts).toHaveLength(1);
  });

  it('refuses the run when two files disagree about one code', () => {
    expect(() =>
      planChart([src('1011', 'ຊັບສິນ', 'Cash'), { ...src('1011', 'ລາຍຈ່າຍ', 'Fuel'), file: 'b.xls' }]),
    ).toThrow(ChartCollisionError);
  });

  it('names both sides of a collision so it can be settled', () => {
    try {
      planChart([src('1011', 'ຊັບສິນ', 'Cash'), { ...src('1011', 'ຊັບສິນ', 'Petty cash'), file: 'b.xls' }]);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as Error).message).toContain('Cash');
      expect((e as Error).message).toContain('Petty cash');
      expect((e as Error).message).toContain('b.xls');
    }
  });
});

// ---- The rule, over the customer's actual chart ---------------------------------------------

describe.skipIf(!hasFiles)('the customer merged chart', () => {
  const plan = () => planChart([...readChartFile(PARENT_CHART), ...readChartFile(COMPANY_CHART)]);

  it('merges 4,083 codes with nothing to reconcile', () => {
    const p = plan();
    expect(p.accounts.length + p.skipped.length).toBe(4083);
  });

  it('parents all but the seven class heads', () => {
    const p = plan();
    expect(p.roots).toEqual(['1', '2', '3', '4', '5', '6', '7'].filter((r) => r !== '5'));
    expect(p.accounts.filter((a) => a.parentCode).length).toBe(4067 - 6);
  });

  it('finds a parent in the parent chart for every one of the 742 company accounts', () => {
    // The claim the whole import rests on: these two files interlock.
    const p = plan();
    const companyCodes = new Set(readChartFile(COMPANY_CHART).map((r) => r.code));
    const parentChartCodes = new Set(readChartFile(PARENT_CHART).map((r) => r.code));
    const company = p.accounts.filter((a) => companyCodes.has(a.code));
    expect(company).toHaveLength(742);
    expect(company.every((a) => a.parentCode && parentChartCodes.has(a.parentCode))).toBe(true);
  });

  it('skips the 16 suspense accounts of class 5 and nothing else', () => {
    const p = plan();
    expect(p.skipped).toHaveLength(16);
    expect(p.skipped.every((s) => s.code === '5' || s.code.startsWith('5'))).toBe(true);
    expect(p.accounts.some((a) => a.code === '5')).toBe(false);
  });

  it('plans 4,067 accounts', () => {
    expect(plan().accounts).toHaveLength(4067);
  });

  it('marks 179 headers and leaves the rest postable', () => {
    // 184 accounts of the raw 4,083 have children; five of them are class-5 rows that are skipped,
    // so 179 headers are written. The two numbers are not in conflict — one counts the file, the
    // other counts what gets created.
    const p = plan();
    expect(p.accounts.filter((a) => !a.isPostable)).toHaveLength(179);
    expect(p.accounts.filter((a) => a.isPostable)).toHaveLength(4067 - 179);
  });

  it('reports 31 children whose type differs from their parent', () => {
    // The rows the same-type rule would have rejected. Reported, not refused.
    //
    // The raw chart holds 46 such pairs; 15 of them have a class-5 account on one side and vanish
    // with it, leaving 31 among the accounts actually written. 46 is the fact about their file,
    // 31 is the fact about this import.
    const p = plan();
    expect(p.crossType).toHaveLength(31);
    const pair = p.crossType.find((c) => c.code === '752.01');
    expect(pair).toMatchObject({ parentCode: '752', accountType: AccountType.ASSET, parentType: AccountType.REVENUE });
  });

  it('places the customer own example under its parent chart head', () => {
    const p = plan();
    const byCode = new Map(p.accounts.map((a) => [a.code, a]));
    expect(byCode.get('1017.0001')?.parentCode).toBe('1017');
    expect(byCode.get('1017')?.isPostable).toBe(false);
    expect(byCode.get('1017.0001')?.isPostable).toBe(true);
  });

  it('imports class 3 as LIABILITY, following the class column', () => {
    // The head reads `ບັນຊີ ທຶນ` (capital) and the system has EQUITY, but the bookkeeper wrote
    // ໜີ້ສິນ on all 21 rows and the column is the classification.
    const p = plan();
    const cls3 = p.accounts.filter((a) => a.code === '3' || a.code.startsWith('3'));
    expect(cls3.every((a) => a.accountType === AccountType.LIABILITY)).toBe(true);
    expect(p.accounts.some((a) => a.accountType === AccountType.EQUITY)).toBe(false);
  });
});

if (!hasFiles) {
  // eslint-disable-next-line no-console
  console.warn('[chart-import] customer chart files not present — skipping merge spec');
}
