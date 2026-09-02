import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Scope } from '../../../common/enums';

// A batch is a UI-driven edit over a catalog of known size; cap it so an unbounded array
// can't hold a transaction open. Keep in step with RBAC_BULK_MAX in @erp/shared.
const BULK_MAX = 200;

/**
 * Create a non-human identity (bot/integration) plus its first company-role assignment in one
 * step. Company comes from context, never the body.
 *
 * There is deliberately NO password field, and no server-side default password either: unlike
 * employee onboarding, this path never reads USER_PASSWORD. A service account authenticates only
 * by API key, so giving it a password would hand it an interactive login it must never have.
 *
 * `email` is required because `app_user.email` is unique and NOT NULL. It identifies the account
 * (e.g. claim-bot@hal.local) and is never mailed to.
 */
export class CreateServiceAccountDto {
  @IsString()
  @MaxLength(255)
  username!: string;

  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsUUID()
  roleId!: string;

  @IsUUID()
  departmentId!: string;
}

export class CreateRoleDto {
  @IsString()
  @MaxLength(255)
  code!: string;

  @IsString()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}

export class AttachPermissionDto {
  @IsUUID()
  roleId!: string;

  @IsString()
  permissionCode!: string;

  @IsEnum(Scope)
  scope!: Scope;
}

export class AssignRoleDto {
  @IsUUID()
  userId!: string;

  // companyId is taken from the admin's active-company context, not the body.

  @IsUUID()
  roleId!: string;

  @IsUUID()
  departmentId!: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @IsOptional()
  @IsDateString()
  validTo?: string;
}

/** One staged grant in a bulk role-permission edit. */
export class BulkGrantDto {
  @IsString()
  permissionCode!: string;

  @IsEnum(Scope)
  scope!: Scope;
}

export class BulkAttachPermissionsDto {
  @IsUUID()
  roleId!: string;

  @IsArray()
  @ArrayMaxSize(BULK_MAX)
  @ValidateNested({ each: true })
  @Type(() => BulkGrantDto)
  grants!: BulkGrantDto[];

  @IsArray()
  @ArrayMaxSize(BULK_MAX)
  @IsString({ each: true })
  detach!: string[];
}

export class BulkAssignRolesDto {
  @IsUUID()
  userId!: string;

  // companyId is taken from the admin's active-company context, not the body.

  @IsUUID()
  departmentId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_MAX)
  @IsUUID(undefined, { each: true })
  roleIds!: string[];

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @IsOptional()
  @IsDateString()
  validTo?: string;
}

export class RevokeAccessDto {
  @IsUUID()
  userId!: string;

  @IsUUID()
  companyId!: string;
}

export class DetachPermissionDto {
  @IsUUID()
  roleId!: string;

  @IsString()
  permissionCode!: string;
}
