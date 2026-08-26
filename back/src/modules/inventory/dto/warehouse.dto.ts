import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { SearchablePaginationQueryDto } from '../../../common/pagination/pagination';

/**
 * Query for listing warehouses. `includeInactive` is a declared DTO field, not a loose @Query
 * param: the global whitelist pipe runs with `forbidNonWhitelisted`, so an undeclared query
 * parameter is a 400 rather than being ignored. The admin surface passes it to see deactivated
 * warehouses; the default (active-only) serves the movement pickers.
 */
export class ListWarehousesQueryDto extends SearchablePaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}

export class CreateWarehouseDto {
  @IsString()
  @MaxLength(255)
  code!: string;

  @IsString()
  @MaxLength(255)
  name!: string;
}

export class UpdateWarehouseDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
