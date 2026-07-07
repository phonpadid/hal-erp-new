import {
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UpsertEntitlementDto {
  @IsUUID()
  quotaId!: string;

  @IsUUID()
  employeeId!: string;

  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  @IsNumberString()
  entitledValue!: string;

  @IsOptional()
  @IsNumberString()
  carriedOver?: string;

  @IsOptional()
  @IsNumberString()
  adjusted?: string;
}

/** Mid-year adjustment: a signed delta applied to `adjusted` (may be negative). */
export class AdjustEntitlementDto {
  @IsUUID()
  quotaId!: string;

  @IsUUID()
  employeeId!: string;

  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  @Matches(/^-?\d+(\.\d+)?$/, { message: 'delta must be a signed decimal string' })
  delta!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}

/** Quota-wide carry-forward: seed `toYear` from each employee's `fromYear` remaining. */
export class CarryForwardDto {
  @IsUUID()
  quotaId!: string;

  @IsInt()
  @Min(2000)
  @Max(2100)
  fromYear!: number;

  @IsInt()
  @Min(2000)
  @Max(2100)
  toYear!: number;
}

export class EntitlementQueryDto {
  @IsUUID()
  quotaId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;
}
