import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

/** Per-line withholding, chosen before export because the file must carry the net amount. */
export class BatchLineInput {
  @IsUUID()
  documentId!: string;

  @IsOptional()
  @IsUUID()
  whtTaxCodeId?: string;
}

export class BuildBatchDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('all', { each: true })
  documentIds!: string[];

  @IsOptional()
  @IsDateString()
  payDate?: string;

  // Selects the BankFileFormatter. Unknown values are rejected at export rather than silently
  // falling back — sending a bank the wrong layout is worse than sending nothing.
  @IsOptional()
  @IsString()
  format?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BatchLineInput)
  lines?: BatchLineInput[];
}

/** One line's outcome as the bank reported it, plus the rate finance keyed for it. */
export class ImportLineDto {
  @IsUUID()
  documentId!: string;

  @IsIn(['SUCCESS', 'FAILED'])
  result!: 'SUCCESS' | 'FAILED';

  // A decimal string, never a JS number: money and rates lose precision as floats.
  @IsOptional()
  @IsNumberString()
  actualRate?: string;

  @IsOptional()
  @IsString()
  failReason?: string;
}

export class ImportResultDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ImportLineDto)
  lines!: ImportLineDto[];
}
