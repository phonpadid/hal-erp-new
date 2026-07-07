import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

/** Partial upsert payload — every field optional (PUT applies only what's sent). */
export class UpdateUserSettingDto {
  @IsOptional()
  @IsString()
  preset?: string;

  @IsOptional()
  @IsString()
  primary?: string;

  @IsOptional()
  @IsString()
  surface?: string;

  @IsOptional()
  @IsBoolean()
  darkTheme?: boolean;

  @IsOptional()
  @IsIn(['static', 'overlay', 'horizontal', 'slim', 'drawer'])
  menuMode?: string;

  @IsOptional()
  @IsString()
  locale?: string;
}
