import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { AccountType } from '../../../common/enums';
import { SearchablePaginationQueryDto } from '../../../common/pagination/pagination';

// List query: pagination plus an optional include-inactive flag. Kept as its own DTO so the
// whitelist validation pipe (forbidNonWhitelisted) accepts `includeInactive`.
export class ListAccountsQueryDto extends SearchablePaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}

export class CreateAccountDto {
  @IsString()
  @MaxLength(255)
  code!: string;

  @IsString()
  @MaxLength(255)
  name!: string;

  @IsEnum(AccountType)
  accountType!: AccountType;

  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsOptional()
  @IsBoolean()
  isPostable?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsEnum(AccountType)
  accountType?: AccountType;

  // Pass null to detach the parent; omit to leave it unchanged.
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @IsOptional()
  @IsBoolean()
  isPostable?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
