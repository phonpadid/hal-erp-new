import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSpendFile } from './spend-reader';

const WORKBOOK = resolve(
  __dirname,
  '../../../../../data/budget/8ໂມງ48-16-6- 2026 Monitoring budgetplan 2026 30-6-2026 (5).xlsx',
);
const hasFile = existsSync(WORKBOOK);

/**
 * Read against the customer's own file, not a fixture.
 *
 * A fixture would be written from the same understanding of the sheet that the reader is written
 * from, so the two would agree about a column the sheet does not actually put there. These numbers
 * come from the file.
 */
describe.skipIf(!hasFile)('spend reader: the customer’s monitoring sheet', () => {
  // Read on first use, not while collecting. `skipIf` skips the tests inside a describe, but Vitest
  // still RUNS the describe body to find them — so reading at this level throws ENOENT and fails the
  // whole file on any machine without the customer's workbook, which is every machine but one and
  // every CI runner (`data/` is gitignored). `plan-reader.spec.ts` reads lazily for this reason.
  let cached: ReturnType<typeof readSpendFile> | undefined;
  const file = () => (cached ??= readSpendFile(WORKBOOK));

  it('reads every row that carries a plan code, and skips 26 of them for a stated reason', () => {
    expect(file().rows.length).toBe(5689);
    const withCode = file().rows.length + file().skipped.filter((s) => s.reason !== 'NO_CODE').length;
    expect(withCode).toBe(5715);
  });

  it('totals 221,259,490,412 kip', () => {
    const total = file().rows.reduce((s, r) => s + BigInt(r.amount!), 0n);
    expect(total.toString()).toBe('221259490412');
  });

  it('carries a description on all but two rows of the sheet', () => {
    const described =
      file().rows.filter((r) => r.description).length +
      file().skipped.filter((s) => s.reason !== 'NO_CODE' && s.description).length;
    expect(described).toBe(5713);
  });

  it('finds no negative amount — nothing in this history was ever given back', () => {
    expect(file().rows.filter((r) => BigInt(r.amount!) < 0n)).toEqual([]);
  });

  it('names the 25 rows that state no amount', () => {
    const noAmount = file().skipped.filter((s) => s.reason === 'NO_AMOUNT');
    expect(noAmount.length).toBe(25);
    expect(noAmount.every((s) => s.amount === undefined)).toBe(true);
  });

  it('names the one row whose month it cannot read, rather than guessing at it', () => {
    const noMonth = file().skipped.filter((s) => s.reason === 'NO_MONTH');
    expect(noMonth.length).toBe(1);
    // Row 3569 is shifted one column: its month cell holds 2026.
    expect(noMonth[0].row).toBe(3569);
    expect(noMonth[0].amount).toBe('44850000');
  });

  it('names the three rows that state money and no plan code, with the money', () => {
    const noCode = file().skipped.filter((s) => s.reason === 'NO_CODE' && s.amount);
    expect(noCode.length).toBe(3);
    const total = noCode.reduce((s, r) => s + BigInt(r.amount!), 0n);
    expect(total.toString()).toBe('212345600');
  });

  it('reads the converted kip column, not the currency columns that feed it', () => {
    // Row 5 pays 3,712 dollars at 21,695 — the sheet's own product is 80,531,840 kip, and a
    // reader one column to the left would have returned the rate.
    const first = file().rows[0];
    expect(first.row).toBe(5);
    expect(first.amount).toBe('80531840');
    expect(first.code).toBe('19.105');
    expect(first.departmentCode).toBe('19');
    expect(first.description).toContain('API');
    expect({ d: first.day, m: first.month, y: first.year }).toEqual({ d: 2, m: 1, y: 2026 });
    expect(first.sequence).toBe('00001');
  });

  it('reads every row into the year the sheet says, and no month outside 1–12', () => {
    expect(new Set(file().rows.map((r) => r.year))).toEqual(new Set([2026]));
    expect(file().rows.every((r) => r.month >= 1 && r.month <= 12)).toBe(true);
    expect(file().rows.every((r) => r.day >= 1 && r.day <= 31)).toBe(true);
  });
});
