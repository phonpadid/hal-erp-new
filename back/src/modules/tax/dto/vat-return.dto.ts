import { IsISO8601, IsOptional, IsUUID } from 'class-validator';

/** File a VAT return for a period. The amount is NOT an input — it is read from the ledger. */
export class FileVatReturnDto {
  @IsISO8601()
  periodFrom!: string;

  @IsISO8601()
  periodTo!: string;

  /** Defaults to the last day of the period. */
  @IsOptional()
  @IsISO8601()
  filedOn?: string;

  /** Supplied by the client so a retried filing resolves to the return already written. */
  @IsOptional()
  @IsUUID()
  returnId?: string;
}
