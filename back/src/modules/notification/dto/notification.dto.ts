import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/pagination/pagination';

/**
 * Own-inbox list query. Extends the shared `?page=&limit=` DTO so the global
 * whitelist accepts `unreadOnly` instead of rejecting it as an unknown property.
 * The flag arrives as a query string; coerce `'true'`/`'1'` to a real boolean.
 */
export class NotificationListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined ? undefined : value === true || value === 'true' || value === '1',
  )
  @IsBoolean()
  unreadOnly?: boolean;
}

export class CreateTemplateDto {
  @IsString()
  @MaxLength(255)
  code!: string;

  @IsString()
  @MaxLength(50)
  channel!: string; // EMAIL / IN_APP / LINE / SMS

  @IsOptional()
  @IsString()
  @MaxLength(255)
  subjectTemplate?: string;

  @IsOptional()
  @IsString()
  bodyTemplate?: string;
}

export class UpdateTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  subjectTemplate?: string;

  @IsOptional()
  @IsString()
  bodyTemplate?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
