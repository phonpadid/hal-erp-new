import { BadRequestException, Injectable } from '@nestjs/common';
import type { PaymentBatch, PaymentBatchLine } from './payment.entities';

/** One payable as the bank file sees it: the payee, and the amount actually being transferred. */
export interface BankFileRow {
  /** Our reference for the line, so a result file that echoes it can be matched exactly. */
  reference: string;
  bankCode: string;
  accountNo: string;
  accountName: string;
  /**
   * The amount to transfer, NET of withholding, as a decimal string formatted to the currency's
   * decimal places. A string throughout: money is never a JS number on either side of the wire.
   */
  amount: string;
  currency: string;
}

/**
 * Renders a payment run into whatever layout a bank wants.
 *
 * A seam, not an abstraction for its own sake: the layout is per-bank and none of them agree, so
 * the batch stores a `format` discriminator and the concrete formatter is chosen at export. Adding
 * fixed-width or ISO 20022 pain.001 later means adding an implementation here — no schema change,
 * per invariant 7.
 */
export interface BankFileFormatter {
  /** The `payment_batch.format` value this formatter answers to. */
  readonly format: string;
  /** File extension for the exported artifact, e.g. `csv`. */
  readonly extension: string;
  readonly contentType: string;
  render(batch: PaymentBatch, rows: BankFileRow[]): Buffer;
}

/**
 * Resolves a batch's `format` to its formatter.
 *
 * An unknown format is REJECTED rather than defaulted. A default would mean quietly handing a bank
 * a layout it did not ask for, and a bank file that parses as something else is worse than one that
 * never arrives.
 */
@Injectable()
export class BankFileFormatterRegistry {
  private readonly byFormat = new Map<string, BankFileFormatter>();

  constructor(formatters: BankFileFormatter[] = []) {
    for (const f of formatters) this.register(f);
  }

  register(formatter: BankFileFormatter): void {
    this.byFormat.set(formatter.format, formatter);
  }

  resolve(format: string): BankFileFormatter {
    const formatter = this.byFormat.get(format);
    if (!formatter) {
      throw new BadRequestException(
        `No bank file formatter is registered for format '${format}'`,
      );
    }
    return formatter;
  }
}

/**
 * Build the rows for a batch: the payee snapshot the line carries, and the amount net of
 * withholding.
 *
 * Uses the LINE's snapshot rather than the vendor's current account on purpose — a later edit to
 * `vendor_bank_account` must not change what an exported batch says. Export separately refuses a
 * run whose payee has since been deactivated, which is a different question from what to print.
 */
export function toBankFileRows(lines: PaymentBatchLine[], currency: string): BankFileRow[] {
  return lines.map((line) => ({
    reference: line.id,
    bankCode: line.bankCode,
    accountNo: line.accountNo,
    accountName: line.accountName,
    amount: line.netAmount(),
    currency,
  }));
}
