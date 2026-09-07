import { TRANSFER_SOURCES, type TransferSource } from '@erp/shared';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
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
  /**
   * Actual exchange rate at payment (1 doc-currency unit = actualRate base units); decimal string.
   *
   * Optional because the transfer slip normally states it — the person who paid keys it when they
   * attach the slip, and the record adopts it. Supplying it here overrides what the slip said; the
   * service refuses when neither has one.
   */
  @IsOptional()
  @IsNumberString()
  actualRate?: string;

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

  /**
   * Which of the company's accounts a transfer left: PRIMARY or RESERVE. Required when the method
   * is a transfer and refused for cash — the service enforces the pairing, because "which account
   * did it leave" is a question only a transfer has an answer to.
   */
  @IsOptional()
  @IsIn(TRANSFER_SOURCES)
  transferFrom?: TransferSource;

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

/**
 * What is stated alongside a transfer slip.
 *
 * Multipart, so the field arrives as text beside the file. `transferFrom` is optional at the DTO
 * boundary because a slip can evidence cash; the screen that asks for it is the one that decides a
 * transfer must answer.
 */
export class AttachSlipDto {
  @IsOptional()
  @IsIn(TRANSFER_SOURCES)
  transferFrom?: TransferSource;

  /**
   * The rate the money actually converted at, as a decimal string. Stated with the slip because the
   * bank's rate for that day is on the slip; the recorded payment adopts it.
   */
  @IsOptional()
  @IsNumberString()
  actualRate?: string;
}

/**
 * Stating a document's exchange rate on its own — the correction that needs no second copy of a
 * slip already on file. The same figure `AttachSlipDto` carries with a file.
 */
export class StateRateDto {
  @IsNumberString()
  actualRate!: string;
}
