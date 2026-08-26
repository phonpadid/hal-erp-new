import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsNumberString, IsOptional, IsString, MaxLength } from 'class-validator';
import { TaxKind } from '../../../common/enums';
import { SearchablePaginationQueryDto } from '../../../common/pagination/pagination';

export class CreateTaxCodeDto {
  @IsString()
  @MaxLength(255)
  code!: string;

  @IsString()
  @MaxLength(255)
  name!: string;

  @IsEnum(TaxKind)
  kind!: TaxKind;

  // Decimal fraction as a string (rate rule) — e.g. '0.07'.
  @IsNumberString()
  rate!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateTaxCodeDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsNumberString()
  rate?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListTaxCodeQueryDto extends SearchablePaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}
