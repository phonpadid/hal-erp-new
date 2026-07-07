import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { Scope } from '../../../common/enums';

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
