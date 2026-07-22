import {
  IsBoolean,
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

/**
 * Query for listing document categories. `includeInactive` is a declared field (not a loose
 * @Query param) so the global whitelist pipe accepts it; the admin category surface passes it to
 * see (and re-activate) deactivated categories, while the default (active-only) serves Select
 * option consumers such as the document-type create form.
 */
export class ListDocumentCategoriesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}

// Create a document category. `code` is immutable after creation (only settable here). Mirrors
// `documentCategorySchema` in @erp/shared.
export class CreateDocumentCategoryDto {
  @IsString()
  @MaxLength(50)
  code!: string;

  @IsString()
  @MaxLength(255)
  name!: string;
}

// Edit a category: only `name` and active state may change; `code` is immutable. Mirrors
// `documentCategoryUpdateSchema` in @erp/shared.
export class UpdateDocumentCategoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateDocumentTypeDto {
  @IsString()
  @MaxLength(255)
  code!: string;

  @IsString()
  @MaxLength(255)
  name!: string;

  // A document_category *code* (validated in the service against the active company's active
  // categories), mirroring how default_gl_account carries a GL code rather than a FK.
  @IsString()
  @MaxLength(50)
  category!: string;

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

  // Whether a document of this type must name a payee bank account before it can be submitted.
  // Independent of postAction on purpose: a PR settles budget (CUT_BUDGET) without anyone yet
  // knowing which account will be paid.
  @IsOptional()
  @IsBoolean()
  requiresPayee?: boolean;

  @IsOptional()
  @IsBoolean()
  requiresWarehouse?: boolean;

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
  @IsBoolean()
  requiresPayee?: boolean;

  @IsOptional()
  @IsBoolean()
  requiresWarehouse?: boolean;

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

  // When true, the CREATE_SUCCESSOR post-action auto-creates this successor on the predecessor's
  // full approval; defaults to false (manual create-from only).
  @IsOptional()
  @IsBoolean()
  autoCreate?: boolean;

  // Department an auto-created successor is created in — which also pins its form template and
  // workflow. Omit for the source document's own department; set it for a cross-department handoff
  // (PROC→PO into Procurement). Must be a department of the active company. Ignored by manual
  // create-from, which uses the creating user's department.
  @IsOptional()
  @IsUUID()
  successorDepartmentId?: string;
}

// Toggle a pairing's auto-create flag (whether CREATE_SUCCESSOR auto-creates this successor).
export class UpdateRefPairingDto {
  @IsBoolean()
  autoCreate!: boolean;

  // Omit to leave the successor department as-is; null clears it (back to the source document's
  // own department); a uuid must name a department of the active company.
  @IsOptional()
  @IsUUID()
  successorDepartmentId?: string | null;
}
