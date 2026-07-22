import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateItemDto {
  @IsString()
  @MaxLength(255)
  itemCode!: string;

  @IsString()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  defaultUnit?: string;

  /** true = a physical good tracked in a warehouse. Defaults false so nothing changes by accident. */
  @IsOptional()
  @IsBoolean()
  isStockTracked?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateItemDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  defaultUnit?: string;

  @IsOptional()
  @IsBoolean()
  isStockTracked?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Per-company enablement options: the item's GL for the active company (validated on save). */
export class EnableItemDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  defaultGlAccount?: string;
}
