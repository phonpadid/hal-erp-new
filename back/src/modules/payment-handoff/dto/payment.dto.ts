import {
  ArrayMaxSize,
  IsArray,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

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

  // Optional WHT tax code (kind = WHT): withhold from the payee's cash and record the liability.
  // Available whoever the payee is — paying an individual for services is withheld from too.
  @IsOptional()
  @IsUUID()
  whtTaxCodeId?: string;

  /**
   * How the money moved: CASH or TRANSFER. Validated in the service against the supported set so an
   * unknown value is refused BY NAME rather than silently becoming the default — the rule the
   * settlement type carried before `payment` absorbed it.
   *
   * Not an `@IsIn` here: the set lives beside the column it describes, and a list repeated in a DTO
   * is one that drifts from it.
   */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  method?: string;

  /** The bank's transfer number, or whatever identifies the movement outside this system. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
