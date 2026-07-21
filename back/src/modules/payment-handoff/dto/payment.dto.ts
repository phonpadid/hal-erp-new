import { ArrayMaxSize, IsArray, IsNumberString, IsOptional, IsUUID } from 'class-validator';

/** Ask for the transfer-slip state of a page of documents (documents-list status column). */
export class SlipStatusDto {
  // A page of document ids; capped so this can't be turned into an unbounded scan.
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  documentIds!: string[];
}

export class RecordPaymentDto {
  // Actual exchange rate at payment (1 doc-currency unit = actualRate base units); decimal string.
  @IsNumberString()
  actualRate!: string;

  // Optional WHT tax code (kind = WHT): withhold from the vendor's cash and record the liability.
  @IsOptional()
  @IsUUID()
  whtTaxCodeId?: string;
}
