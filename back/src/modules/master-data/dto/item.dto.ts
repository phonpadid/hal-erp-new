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

  @IsOptional()
  @IsString()
  @MaxLength(255)
  defaultGlAccount?: string;

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
  @IsString()
  @MaxLength(255)
  defaultGlAccount?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
