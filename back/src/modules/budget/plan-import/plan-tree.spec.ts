import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { planImport, planPrefixes } from './plan-tree';
import { readPlanFile } from './plan-reader';
import type { PlanRow } from './plan-reader';

const WORKBOOK = resolve(
  __dirname,
  '../../../../../data/budget/8ໂມງ48-16-6- 2026 Monitoring budgetplan 2026 30-6-2026 (5).xlsx',
);
const has = existsSync(WORKBOOK);

const row = (code: string, amount?: string, name = `n-${code}`, r = 1): PlanRow => ({
  code,
  name,
  amount,
  row: r,
});
/** The two subtotal rows the classifier needs to tell the sections apart. */
const SECTIONS = (budgetedAt = 9000) => [
  { raw: 'I ລວມ ຍອດ ມີງົບ', row: budgetedAt },
  { raw: 'II ລວມ ຍອດ ບໍ່ມີງົບ', row: budgetedAt + 100 },
];

describe('plan code prefixes', () => {
  it('walks the tail, then stops at the department', () => {
    expect(planPrefixes('1.111')).toEqual(['1.11', '1.1', '1']);
  });

  it('offers only the department for a one-digit tail', () => {
    expect(planPrefixes('1.1')).toEqual(['1']);
  });

  it('offers nothing for a department', () => {
    expect(planPrefixes('10')).toEqual([]);
  });
});

describe('plan structure', () => {
  it('never makes one department a child of another', () => {
    // The trap: `10` starts with `1`. Read as a prefix, twenty departments collapse into nine.
    const p = planImport([row('1'), row('10'), row('20')], SECTIONS());
    expect(p.nodes.every((n) => n.isDepartmentRoot && !n.parentCode)).toBe(true);
  });

  it('takes the nearest existing shorter tail as the parent', () => {
    const p = planImport([row('1'), row('1.1'), row('1.11'), row('1.111'), row('1.101')], SECTIONS());
    const byCode = new Map(p.nodes.map((n) => [n.code, n]));
    expect(byCode.get('1.111')?.parentCode).toBe('1.11');
    expect(byCode.get('1.101')?.parentCode).toBe('1.1');
    expect(byCode.get('1.11')?.parentCode).toBe('1.1');
    expect(byCode.get('1.1')?.parentCode).toBe('1');
  });

  it('hangs a tail with no shorter match off its department', () => {
    const p = planImport([row('10'), row('10.008')], SECTIONS());
    expect(p.nodes.find((n) => n.code === '10.008')?.parentCode).toBe('10');
  });

  it('keeps the first statement of a code stated twice, and reports both', () => {
    // This used to refuse the whole run. A duplicate is a question about the spreadsheet, not a
    // fault in the 552 lines around it, so the first row wins — arbitrary, but stable, so the same
    // file re-run produces the same plan — and both rows are named in the report.
    const p = planImport(
      [row('3.1', '100', 'Advertising', 5), row('3.1', '200', 'Promotion', 9)],
      SECTIONS(),
    );
    expect(p.duplicates).toHaveLength(1);
    expect(p.duplicates[0]).toMatchObject({
      code: '3.1',
      keptName: 'Advertising',
      keptRow: 5,
      droppedName: 'Promotion',
      droppedRow: 9,
    });
    expect(p.nodes.find((n) => n.code === '3.1')?.name).toBe('Advertising');
  });

  it('says nothing about a code stated twice identically', () => {
    const p = planImport([row('3.1', '100', 'A', 5), row('3.1', '100', 'A', 9)], SECTIONS());
    expect(p.duplicates).toHaveLength(0);
  });
});

describe('who holds the money', () => {
  it('gives a budget to a row with no money beneath it', () => {
    const p = planImport([row('1', '100'), row('1.1', '100')], SECTIONS());
    expect(p.budgets.map((b) => b.code)).toEqual(['1.1']);
  });

  it('carries the plan line name onto the budget', () => {
    // Left out of the first cut: the node carried the name and the budget carried none, which the
    // budgets list hid by falling back to the node and the dashboard showed as a column of dashes.
    const p = planImport([row('1', undefined, 'Admin'), row('1.1', '100', 'Office supplies')], SECTIONS());
    expect(p.budgets[0]).toMatchObject({ code: '1.1', name: 'Office supplies' });
  });

  it('stands the code in when a plan line has no name', () => {
    const p = planImport([row('1', undefined, 'Admin'), row('1.1', '100', '')], SECTIONS());
    expect(p.budgets[0].name).toBe('1.1');
  });

  it('treats a row stating the total of its children as structure', () => {
    const p = planImport([row('1', '100'), row('1.1', '60'), row('1.2', '40')], SECTIONS());
    expect(p.budgets.map((b) => b.code)).toEqual(['1.1', '1.2']);
    expect(p.summaries).toContain('1');
    expect(p.conflicts).toHaveLength(0);
  });

  it('reports, and does not create, a row that disagrees with what is beneath it', () => {
    const p = planImport([row('1', '100'), row('1.1', '60'), row('1.2', '30')], SECTIONS());
    expect(p.budgets.map((b) => b.code)).toEqual(['1.1', '1.2']);
    expect(p.conflicts).toHaveLength(1);
    expect(p.conflicts[0]).toMatchObject({ code: '1', states: '100', beneath: '90' });
  });

  it('counts a subtree once, which is what stops a doubled ceiling', () => {
    const p = planImport([row('1', '100'), row('1.1', '100'), row('1.101', '100')], SECTIONS());
    // Only the deepest holder carries it: 1 and 1.1 are summaries of 1.101.
    expect(p.budgets.map((b) => [b.code, b.amountTotal])).toEqual([['1.101', '100']]);
  });
});

describe('the unbudgeted section', () => {
  it('zeroes a budget stated after the ມີງົບ subtotal', () => {
    const p = planImport(
      [row('14', undefined, 'ຮຸ້ນສ່ວນ', 9500), row('14.1', '3588000000', 'x', 9501)],
      SECTIONS(9000),
    );
    const b = p.budgets.find((x) => x.code === '14.1');
    expect(b?.amountTotal).toBe('0');
    expect(b?.unbudgeted).toBe(true);
    expect(b?.statedAmount).toBe('3588000000');
  });

  it('leaves the figures of the budgeted section alone', () => {
    const p = planImport([row('1', undefined, 'd', 10), row('1.1', '500', 'x', 11)], SECTIONS(9000));
    const b = p.budgets.find((x) => x.code === '1.1');
    expect(b?.amountTotal).toBe('500');
    expect(b?.unbudgeted).toBe(false);
  });

  it('refuses to run when the worksheet states no section subtotals', () => {
    // Without them every line would be treated as budgeted, which is how 16 billion kip of
    // explicitly unbudgeted money would become spendable with nothing looking wrong.
    expect(() => planImport([row('1', '100')], [])).toThrow(/does not state its own/i);
  });
});

describe.skipIf(!has)('the customer plan', () => {
  /**
   * Parsed and imported ONCE. The same reason as `plan-reader.spec.ts`: this ran the workbook read
   * plus the import for each of nine tests, roughly a second apiece, against a 5s per-test default
   * — so it passed alone and failed under load. Pure read, nothing here mutates the result.
   */
  let computed: ReturnType<typeof planImport>;
  beforeAll(() => {
    const { rows, ignored } = readPlanFile(WORKBOOK);
    computed = planImport(rows, ignored);
  });
  const plan = () => computed;

  it('reports `3.1` as stated twice and keeps the first', () => {
    // `ຄ່າໂຄສະນາ` at 1,410,000,000 on row 162 wins; `ຄ່າໂປໂມຊັ້ນ` at 7,492,500,000 on row 175 is
    // set aside. The promotion money is not lost with it — `3.1001`–`3.1003` state the same
    // 7,492,500,000 between them and become budgets in their own right.
    const p = plan();
    expect(p.duplicates).toHaveLength(1);
    expect(p.duplicates[0]).toMatchObject({ code: '3.1', keptRow: 162, droppedRow: 175 });
    const promos = p.budgets.filter((b) => b.code.startsWith('3.100'));
    const promoTotal = promos.reduce((s, b) => s + BigInt(b.amountTotal), 0n);
    expect(promoTotal.toString()).toBe('7492500000');
  });

  it('agrees with the two subtotals the worksheet states for itself', () => {
    // The strongest check available: the file's own arithmetic, not mine.
    const p = plan();
    expect(p.sectionCheck.budgeted).toBe('397602636355');
    expect(p.sectionCheck.unbudgeted).toBe('16017168000');
    expect(p.sectionCheck.total).toBe('413619804355');
  });

  it('creates a node for every plan row and twenty department roots', () => {
    const p = plan();
    expect(p.nodes).toHaveLength(552);
    expect(p.nodes.filter((n) => n.isDepartmentRoot)).toHaveLength(20);
  });

  it('places a line under the category its code names', () => {
    const byCode = new Map(plan().nodes.map((n) => [n.code, n]));
    expect(byCode.get('1.101')?.parentCode).toBe('1.1');
    expect(byCode.get('1.111')?.parentCode).toBe('1.11');
    expect(byCode.get('1.1')?.parentCode).toBe('1');
  });

  it('reports the conflicts rather than choosing between them', () => {
    const p = plan();
    expect(p.conflicts.length).toBeGreaterThan(0);
    const worst = p.conflicts.find((c) => c.code === '12.1');
    expect(worst).toMatchObject({ states: '5319600000', beneath: '22237031916' });
    expect(p.budgets.some((b) => b.code === '12.1')).toBe(false);
  });

  it('zeroes every budget of the unbudgeted departments', () => {
    const p = plan();
    const un = p.budgets.filter((b) => Number(b.departmentCode) >= 14);
    expect(un.length).toBeGreaterThan(0);
    expect(un.every((b) => b.amountTotal === '0')).toBe(true);
    expect(un.some((b) => b.statedAmount && b.statedAmount !== '0')).toBe(true);
  });

  it('creates 241 budgets and leaves the conflicts out of the total', () => {
    const p = plan();
    expect(p.nodes).toHaveLength(552);
    expect(p.budgets).toHaveLength(241);
    expect(p.summaries).toHaveLength(51);
    expect(p.conflicts).toHaveLength(21);
    const total = p.budgets.reduce((s, b) => s + BigInt(b.amountTotal), 0n);
    // Short of the budgeted section's 397,602,636,355 by exactly the conflicts — money the file
    // states twice over and this import will not choose between.
    expect(total.toString()).toBe('394685630508');
    expect((397602636355n - total).toString()).toBe('2917005847');
  });

  it('reconciles five departments exactly and names the eight it cannot', () => {
    // Five of the thirteen budgeted departments come out to the kip: 1, 4, 5, 7 and 10. The other
    // eight each hold at least one conflicting row, which is precisely what the report is for.
    const p = plan();
    const budgeted = p.departments.filter((d) => !d.unbudgeted);
    expect(budgeted).toHaveLength(13);
    expect(budgeted.filter((d) => d.agrees).map((d) => d.departmentCode)).toEqual(['1', '4', '5', '7', '10']);
    // Every department is accounted for either way — none is silently missing.
    expect(p.departments).toHaveLength(20);
  });

  it('counts an unbudgeted department as correct when it created nothing', () => {
    const p = plan();
    const un = p.departments.filter((d) => d.unbudgeted);
    expect(un).toHaveLength(7);
    expect(un.every((d) => d.agrees)).toBe(true);
    expect(un.every((d) => d.created === '0')).toBe(true);
  });
});

if (!has) {
  // eslint-disable-next-line no-console
  console.warn('[plan-import] customer workbook not present — skipping tree spec');
}
