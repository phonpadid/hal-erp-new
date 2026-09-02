import { IsDateString, IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * A period is declared as an explicit range, not a year and a month: a company whose books run the
 * 26th to the 25th has to be able to say so.
 */
export class DeclarePeriodDto {
  @IsUUID()
  fiscalYearId!: string;

  /** What people call it, e.g. `2026-08`. Not parsed — the dates below are what the code reads. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  code!: string;

  @IsDateString()
  periodStart!: string;

  @IsDateString()
  periodEnd!: string;
}

export class ReopenPeriodDto {
  /** Required: reopening a month that has been reported should cost at least a sentence. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
