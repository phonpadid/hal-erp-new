import {
  ArrayNotEmpty,
  IsArray,
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
import { FIELD_TYPES, POST_ACTIONS, PRINT_TEMPLATES, type PrintTemplate } from '@erp/shared';
import {
  PaginationQueryDto,
  SearchablePaginationQueryDto,
} from '../../../common/pagination/pagination';

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

  // Recognise the expense at full approval (debit the budget's expense accounts, credit the
  // payable) instead of when a payment settles.
  //
  // Combinable with requiresPayee, and the seeded DISB sets both. It was once not: before the
  // payable existed, both paths debited the same expense accounts and a type carrying both
  // recognised its expense twice. The payment path now checks for an accrual and clears the payable
  // instead, so the combination is the correct configuration for a disbursement rather than a
  // forbidden one.
  @IsOptional()
  @IsBoolean()
  accruesOnApproval?: boolean;

  @IsOptional()
  @IsBoolean()
  requiresWarehouse?: boolean;

  // The document must name a related_employee before submit — the fifth flag of the same shape.
  @IsOptional()
  @IsBoolean()
  requiresEmployee?: boolean;

  // This type is the form for recording something that ALREADY happened: its documents may state
  // the day their money moved, and the budget ledger dates their rows by that day instead of by the
  // clock. Off for every type used for daily work.
  @IsOptional()
  @IsBoolean()
  recordsPastEvents?: boolean;

  // Null = the generic wizard authors this type. A value names the screen that does.
  @IsOptional()
  @IsString()
  @MaxLength(255)
  authoringRoute?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  defaultGlAccount?: string;

  // One of the closed set, or null for "does nothing on approval". A free-form string here used to
  // let a misspelling configure a type that approved and then did nothing at all.
  @IsOptional()
  @IsIn(POST_ACTIONS)
  postAction?: (typeof POST_ACTIONS)[number] | null;

  // Which sheets a document of this type prints, in one to four entries. Omitted leaves the column
  // at its LETTER default — not nullable and never empty, because every document prints as
  // something and a second spelling of "the letter" is the ambiguity post_action had to be cleaned
  // of. The server stores them in print order regardless of the order they arrive in.
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(PRINT_TEMPLATES, { each: true })
  printTemplates?: PrintTemplate[];
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
  accruesOnApproval?: boolean;

  @IsOptional()
  @IsBoolean()
  requiresWarehouse?: boolean;

  // The document must name a related_employee before submit — the fifth flag of the same shape.
  @IsOptional()
  @IsBoolean()
  requiresEmployee?: boolean;

  // This type is the form for recording something that ALREADY happened: its documents may state
  // the day their money moved, and the budget ledger dates their rows by that day instead of by the
  // clock. Off for every type used for daily work.
  @IsOptional()
  @IsBoolean()
  recordsPastEvents?: boolean;

  // Null = the generic wizard authors this type. A value names the screen that does.
  @IsOptional()
  @IsString()
  @MaxLength(255)
  authoringRoute?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  defaultGlAccount?: string;

  @IsOptional()
  @IsIn(POST_ACTIONS)
  postAction?: (typeof POST_ACTIONS)[number] | null;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(PRINT_TEMPLATES, { each: true })
  printTemplates?: PrintTemplate[];

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

/**
 * The department-mapping list's query: paging, a search term, and the three dimensions the screen
 * shows columns for.
 *
 * All three are optional and NONE has a default. `isActive` in particular does not default to
 * `true`: a list that silently hides the deactivated mappings cannot answer why a department lost a
 * document type, which is one of the two questions the screen exists for. The screen states what it
 * is hiding instead — the same call `BudgetListQueryDto` made, for the same reason.
 *
 * `isActive` is a tri-state on the wire — absent, `true`, `false` — because "show me the
 * deactivated ones" is the question worth asking and a two-value control cannot express it.
 */
export class DeptDocTypeListQueryDto extends SearchablePaginationQueryDto {
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  documentTypeId?: string;

  // Query strings arrive as text; `?isActive=false` must not read as the truthy string "false".
  @IsOptional()
  @Transform(({ value }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : undefined))
  @IsBoolean()
  isActive?: boolean;
}
