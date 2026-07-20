import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { CsvBankFileFormatter } from './csv-bank-file.formatter';
import type { BankFileRow } from './bank-file-formatter';
import type { PaymentBatch } from './payment.entities';

const BATCH = { id: 'b1' } as PaymentBatch;

function row(over: Partial<BankFileRow> = {}): BankFileRow {
  return {
    reference: 'line-1',
    bankCode: 'BCEL',
    accountNo: '0101234567',
    accountName: 'Acme Supplies',
    amount: '97000.00',
    currency: 'LAK',
    ...over,
  };
}

/**
 * The default CSV layout.
 *
 * The columns are provisional — no bank has confirmed them — so these tests pin the properties that
 * must hold whatever the columns become: account numbers survive as text, amounts are never
 * re-formatted through a float, and a result file we cannot read with confidence is refused rather
 * than half-applied.
 */
describe('CsvBankFileFormatter', () => {
  const f = new CsvBankFileFormatter();

  // ---- Export ----------------------------------------------------------------

  it('writes a header and one row per payable', () => {
    const csv = f.render(BATCH, [row(), row({ reference: 'line-2', accountNo: '0209876543' })]).toString();

    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('bank_code,account_no,account_name,amount,currency,reference');
    expect(lines).toHaveLength(3);
  });

  it('keeps an account number’s leading zeros', () => {
    const csv = f.render(BATCH, [row({ accountNo: '000123' })]).toString();

    // The whole reason it is a string end to end: as a number this is 123, a different account.
    expect(csv).toContain('000123');
  });

  it('writes the amount exactly as given, without re-formatting', () => {
    const csv = f.render(BATCH, [row({ amount: '97000.00' })]).toString();

    // Already rounded to the currency's places upstream. Touching it here would risk 97000.00 →
    // 97000.000000001 on the one value that moves money.
    expect(csv).toContain('97000.00');
  });

  it('quotes a field containing a comma, so the row cannot break', () => {
    const csv = f.render(BATCH, [row({ accountName: 'Acme, Inc' })]).toString();

    expect(csv).toContain('"Acme, Inc"');
    // Still six fields, not seven.
    expect(f.parseResult('reference,status\nline-1,SUCCESS')).toHaveLength(1);
  });

  it('escapes an embedded quote by doubling it', () => {
    const csv = f.render(BATCH, [row({ accountName: 'The "Real" Co' })]).toString();

    expect(csv).toContain('"The ""Real"" Co"');
  });

  it('ends with a newline, which some bank portals need to see the last row', () => {
    const csv = f.render(BATCH, [row()]).toString();

    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('carries our reference, so the result can be matched exactly', () => {
    const csv = f.render(BATCH, [row({ reference: 'line-abc' })]).toString();

    // Matching on account + amount instead would be ambiguous the moment one vendor is paid twice
    // for the same amount in one run.
    expect(csv).toContain('line-abc');
  });

  // ---- Result parsing --------------------------------------------------------

  it('parses a result file', () => {
    const rows = f.parseResult('reference,status,reason\r\nline-1,SUCCESS,\r\nline-2,FAILED,Account closed\r\n');

    expect(rows).toEqual([
      { reference: 'line-1', status: 'SUCCESS', reason: undefined },
      { reference: 'line-2', status: 'FAILED', reason: 'Account closed' },
    ]);
  });

  it('accepts the columns in any order and any case', () => {
    const rows = f.parseResult('Status,Reference\nSUCCESS,line-1');

    // Banks are not consistent about either; the header is what we read, not the position.
    expect(rows[0]).toMatchObject({ reference: 'line-1', status: 'SUCCESS' });
  });

  it('accepts a lowercase status', () => {
    expect(f.parseResult('reference,status\nline-1,success')[0].status).toBe('SUCCESS');
  });

  it('tolerates a missing reason column', () => {
    expect(f.parseResult('reference,status\nline-1,FAILED')[0].reason).toBeUndefined();
  });

  it('refuses a file with no reference column', () => {
    // Without it we could only guess which payment each row is about.
    expect(() => f.parseResult('status,reason\nSUCCESS,')).toThrow(BadRequestException);
  });

  it('refuses a status the bank never promised us', () => {
    expect(() => f.parseResult('reference,status\nline-1,MAYBE')).toThrow(/expected SUCCESS or FAILED/);
  });

  it('refuses a row with an empty reference', () => {
    expect(() => f.parseResult('reference,status\n,SUCCESS')).toThrow(/no reference/);
  });

  it('refuses an empty file', () => {
    expect(() => f.parseResult('   \n\n')).toThrow(/empty/);
  });

  it('names the offending row so it can be found in the file', () => {
    // Row 3 = the second data row, counting the header as row 1 the way a spreadsheet does.
    expect(() => f.parseResult('reference,status\nline-1,SUCCESS\nline-2,OOPS')).toThrow(/row 3/);
  });

  it('round-trips a reference through export and back', () => {
    const csv = f.render(BATCH, [row({ reference: 'line-xyz' })]).toString();
    const reference = csv.trim().split('\r\n')[1].split(',')[5];

    const rows = f.parseResult(`reference,status\n${reference},SUCCESS`);

    // The export and the parser must agree about the reference, or every import fails to match.
    expect(rows[0].reference).toBe('line-xyz');
  });
});
