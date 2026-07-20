import { BadRequestException, Injectable } from '@nestjs/common';
import type { BankFileFormatter, BankFileRow } from './bank-file-formatter';
import type { PaymentBatch } from './payment.entities';

/** Export columns, in order. */
export const CSV_EXPORT_HEADER = [
  'bank_code',
  'account_no',
  'account_name',
  'amount',
  'currency',
  'reference',
] as const;

/** Result columns the bank is expected to return. */
export const CSV_RESULT_HEADER = ['reference', 'status', 'reason'] as const;

/** One parsed result row: our line reference, and what the bank did with it. */
export interface ParsedResultRow {
  reference: string;
  status: 'SUCCESS' | 'FAILED';
  reason?: string;
}

/** RFC-4180 quoting: only when the value could otherwise break the row. */
function quote(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Split one CSV line, honouring quoted fields and doubled quotes inside them.
 *
 * Hand-rolled rather than pulling in a dependency: the grammar here is one line of RFC 4180, and a
 * parser library would be a supply-chain risk on the path that moves money.
 */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      out.push(field);
      field = '';
    } else {
      field += c;
    }
  }
  out.push(field);
  return out.map((f) => f.trim());
}

/**
 * The default CSV layout: a header row, then one row per payable.
 *
 * **The column set is provisional.** No bank has confirmed it — it is the shape most Thai/Lao banks
 * ask for, chosen so the feature works today and adjusted once a real spec arrives. Changing it
 * means editing this class only: the seam keeps the schema, the batch lifecycle, and every export
 * rule out of it.
 *
 * `reference` is the batch LINE's id, which is what makes matching the result exact. Without it a
 * result could only be matched on account number and amount — ambiguous the moment one vendor is
 * paid twice for the same amount in one run, which is exactly when a mistake costs money.
 */
@Injectable()
export class CsvBankFileFormatter implements BankFileFormatter {
  readonly format = 'CSV';
  readonly extension = 'csv';
  readonly contentType = 'text/csv';

  render(_batch: PaymentBatch, rows: BankFileRow[]): Buffer {
    const lines = [
      CSV_EXPORT_HEADER.join(','),
      ...rows.map((r) =>
        [
          // Every field is quoted-if-needed as text. The account number especially: it identifies,
          // it does not measure, and a spreadsheet would eat its leading zeros.
          quote(r.bankCode),
          quote(r.accountNo),
          quote(r.accountName),
          // Already a decimal string rounded to the currency's places — never re-formatted through
          // a JS number on the way out.
          quote(r.amount),
          quote(r.currency),
          quote(r.reference),
        ].join(','),
      ),
    ];
    // Trailing newline: some bank portals drop a last row that has none.
    return Buffer.from(`${lines.join('\r\n')}\r\n`, 'utf8');
  }

  /**
   * Parse the bank's result file into rows.
   *
   * Anything it cannot read with confidence throws, which aborts the whole import: a result file we
   * half-understand is worse than one we reject, because the half we got wrong silently decides
   * whether real money is recorded as paid.
   */
  parseResult(content: string): ParsedResultRow[] {
    const lines = content
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) throw new BadRequestException('The result file is empty');

    const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
    const missing = CSV_RESULT_HEADER.filter((h) => h !== 'reason' && !header.includes(h));
    if (missing.length > 0) {
      throw new BadRequestException(
        `The result file is missing the column(s): ${missing.join(', ')} — expected ${CSV_RESULT_HEADER.join(', ')}`,
      );
    }
    const refAt = header.indexOf('reference');
    const statusAt = header.indexOf('status');
    const reasonAt = header.indexOf('reason');

    return lines.slice(1).map((line, i) => {
      const cells = splitCsvLine(line);
      const reference = cells[refAt];
      const status = (cells[statusAt] ?? '').toUpperCase();
      if (!reference) {
        throw new BadRequestException(`The result file row ${i + 2} has no reference`);
      }
      if (status !== 'SUCCESS' && status !== 'FAILED') {
        throw new BadRequestException(
          `The result file row ${i + 2} has status '${cells[statusAt]}' — expected SUCCESS or FAILED`,
        );
      }
      return {
        reference,
        status,
        reason: reasonAt >= 0 ? cells[reasonAt] || undefined : undefined,
      };
    });
  }
}
