import { IsDateString, IsOptional } from 'class-validator';

/** Date-range window (inclusive) on journal_entry.entry_date. Both bounds optional. */
export class DateRangeQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

/** As-of date (inclusive) for the balance sheet. */
export class AsOfQueryDto {
  @IsOptional()
  @IsDateString()
  asOf?: string;
}
