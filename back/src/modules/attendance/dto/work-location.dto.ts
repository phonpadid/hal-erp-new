import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ControlPolicy } from '../../../common/enums';
import { PaginationQueryDto } from '../../../common/pagination/pagination';

/**
 * Coordinates travel as strings, never JS numbers. They are decimal(9,6) in the database, and
 * this codebase does not put a value of consequence through a float — a geofence decision is
 * exactly the kind of comparison that should not inherit binary rounding.
 */
export class CreateWorkLocationDto {
  @IsString()
  @MaxLength(255)
  code!: string;

  @IsString()
  @MaxLength(255)
  name!: string;

  @IsNumberString({ no_symbols: false }, { message: 'latitude must be a decimal string' })
  latitude!: string;

  @IsNumberString({ no_symbols: false }, { message: 'longitude must be a decimal string' })
  longitude!: string;

  @IsInt()
  @Min(1)
  @Max(100_000)
  radiusMeters!: number;

  @IsOptional()
  @IsEnum(ControlPolicy)
  controlPolicy?: ControlPolicy;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateWorkLocationDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsNumberString({ no_symbols: false }, { message: 'latitude must be a decimal string' })
  latitude?: string;

  @IsOptional()
  @IsNumberString({ no_symbols: false }, { message: 'longitude must be a decimal string' })
  longitude?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  radiusMeters?: number;

  @IsOptional()
  @IsEnum(ControlPolicy)
  controlPolicy?: ControlPolicy;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListWorkLocationQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}
