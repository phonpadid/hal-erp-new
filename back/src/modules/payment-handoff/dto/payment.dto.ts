import { IsNumberString, IsOptional, IsUUID } from 'class-validator';

export class RecordPaymentDto {
  // Actual exchange rate at payment (1 doc-currency unit = actualRate base units); decimal string.
  @IsNumberString()
  actualRate!: string;

  // Optional WHT tax code (kind = WHT): withhold from the vendor's cash and record the liability.
  @IsOptional()
  @IsUUID()
  whtTaxCodeId?: string;
}
