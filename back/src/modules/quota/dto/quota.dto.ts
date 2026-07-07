import {
  IsBoolean,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateQuotaDto {
  @IsString()
  @MaxLength(255)
  quotaType!: string;

  @IsString()
  @MaxLength(255)
  unit!: string;

  @IsNumberString()
  limitValue!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  resetCycle?: string;

  // Allow rolling unused balance across reset periods (defaults to true).
  @IsOptional()
  @IsBoolean()
  carryForward?: boolean;

  // null/absent = company-level quota.
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}

export class UpdateQuotaDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  quotaType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  unit?: string;

  @IsOptional()
  @IsNumberString()
  limitValue?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  resetCycle?: string;

  @IsOptional()
  @IsBoolean()
  carryForward?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
