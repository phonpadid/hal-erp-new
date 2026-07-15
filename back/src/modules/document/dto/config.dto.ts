import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { FIELD_TYPES } from '@erp/shared';
import { DocCategory } from '../../../common/enums';
import { PaginationQueryDto } from '../../../common/pagination/pagination';

/**
 * Query for listing a document type's form templates: pagination plus the required
 * documentTypeId filter. Declared as a DTO field (not a loose @Query param) so the global
 * whitelist validation accepts it instead of rejecting it as an unknown property.
 */
export class ListFormTemplatesQueryDto extends PaginationQueryDto {
  @IsUUID()
  documentTypeId!: string;
}

/**
 * Query for listing document types. `includeInactive` is declared as a DTO field (not a loose
 * @Query param) so the global whitelist pipe (forbidNonWhitelisted) accepts it. The admin config
 * area passes it so the status filter and inline active toggle can see deactivated types; the
 * default (active-only) still serves Select-option consumers.
 */
export class ListDocumentTypesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}

export class CreateDocumentTypeDto {
  @IsString()
  @MaxLength(255)
  code!: string;

  @IsString()
  @MaxLength(255)
  name!: string;

  @IsEnum(DocCategory)
  category!: DocCategory;

  @IsOptional()
  @IsBoolean()
  requiresBudget?: boolean;

  @IsOptional()
  @IsBoolean()
  requiresQuota?: boolean;

  @IsOptional()
  @IsBoolean()
  requiresVendor?: boolean;

  @IsOptional()
  @IsBoolean()
  requiresItem?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  defaultGlAccount?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  postAction?: string;
}

export class UpdateDocumentTypeDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsBoolean()
  requiresBudget?: boolean;

  @IsOptional()
  @IsBoolean()
  requiresQuota?: boolean;

  @IsOptional()
  @IsBoolean()
  requiresVendor?: boolean;

  @IsOptional()
  @IsBoolean()
  requiresItem?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  defaultGlAccount?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  postAction?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateFormTemplateDto {
  @IsUUID()
  documentTypeId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}

export class CreateFormFieldDto {
  @IsUUID()
  formTemplateId!: string;

  @IsString()
  @MaxLength(255)
  fieldName!: string;

  @IsString()
  @MaxLength(255)
  fieldLabel!: string;

  @IsIn([...FIELD_TYPES])
  fieldType!: string;

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsString()
  optionsJson?: string;

  @IsOptional()
  @IsString()
  conditionJson?: string;
}

export class UpdateFormFieldDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  fieldLabel?: string;

  @IsOptional()
  @IsIn([...FIELD_TYPES])
  fieldType?: string;

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsString()
  optionsJson?: string;

  @IsOptional()
  @IsString()
  conditionJson?: string;
}

export class CreateDeptDocTypeDto {
  @IsUUID()
  departmentId!: string;

  @IsUUID()
  documentTypeId!: string;

  @IsUUID()
  formTemplateId!: string;

  @IsUUID()
  workflowId!: string;
}

// Edit an existing mapping: only workflow / form template / active state may change; the
// (department, document type) identity is fixed. Mirrors `deptDocTypeUpdateSchema` in @erp/shared.
export class UpdateDeptDocTypeDto {
  @IsOptional()
  @IsUUID()
  workflowId?: string;

  @IsOptional()
  @IsUUID()
  formTemplateId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// List a document type's reference-chain pairings. `documentTypeId` is a declared field (not a
// loose @Query param) so the global whitelist pipe accepts it.
export class ListRefPairingsQueryDto {
  @IsUUID()
  documentTypeId!: string;
}

// Create a reference-chain pairing (document_type_ref). Mirrors `refPairingSchema` in
// @erp/shared. Both types must belong to the active company and differ — enforced server-side.
export class CreateRefPairingDto {
  @IsUUID()
  predecessorTypeId!: string;

  @IsUUID()
  successorTypeId!: string;
}
