import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsDateString, IsNotEmpty, IsOptional, IsString, IsUUID, Matches,
  MaxLength, ValidateNested,
} from 'class-validator';

/** Decimal string, e.g. `1000.00`. Money never crosses the wire as a JS number. */
const MONEY = /^\d+(\.\d{1,2})?$/;

export class JournalVoucherLineDto {
  /** Resolved through the chart-of-accounts resolver, which rejects anything unusable. */
  @IsString()
  @IsNotEmpty()
  accountCode!: string;

  @Matches(MONEY, { message: 'debit must be a decimal string such as "1000.00"' })
  debit!: string;

  @Matches(MONEY, { message: 'credit must be a decimal string such as "1000.00"' })
  credit!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  memo?: string;
}

/**
 * The entry no event produces. Depreciation, an accrual at period close, prepaid amortisation,
 * payroll, opening balances carried in from a previous system.
 */
export class PostJournalVoucherDto {
  /**
   * The voucher's identity, optional. Supply one and a retried request resolves to the same entry
   * rather than a second one, using the uniqueness `journal_entry` already has on
   * `(company, source_type, source_id)` — the same contract `document.source_id` gives external
   * callers. Omit it and the server generates one, and the request is not idempotent: a caller who
   * did not ask for that protection does not get it.
   */
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsDateString()
  entryDate!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  memo!: string;

  /** Two lines is the minimum that can balance; one is a mistake caught before the ledger sees it. */
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => JournalVoucherLineDto)
  lines!: JournalVoucherLineDto[];
}

export class ReverseEntryDto {
  /**
   * Defaults to today, deliberately not to the original's date: the original's period is frequently
   * closed — often the reason it is being reversed — and dating a correction into a month somebody
   * has already reported would either be refused or restate figures they acted on.
   */
  @IsOptional()
  @IsDateString()
  entryDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  memo?: string;
}

export class RejectVoucherDto {
  /** Required: a refusal that costs a sentence is one somebody can act on. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
