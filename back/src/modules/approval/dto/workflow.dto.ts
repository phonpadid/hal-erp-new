import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { HUMAN_ACTIONS, type HumanAction } from '../../../common/enums';
import { PaginationQueryDto } from '../../../common/pagination/pagination';

// A workflow carries no selection condition: it is chosen by its `dept_doc_type` mapping, and every
// condition routing evaluates lives on its steps.
export class CreateWorkflowDto {
  @IsString()
  @MaxLength(255)
  name!: string;
}

// Partial update of a workflow's own attributes (not its steps). All fields optional.
export class UpdateWorkflowDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateWorkflowStepDto {
  @IsUUID()
  workflowId!: string;

  @IsInt()
  @Min(1)
  stepNo!: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  stepName?: string;

  @IsOptional()
  @IsUUID()
  approverRoleId?: string;

  @IsOptional()
  @IsUUID()
  approverUserId?: string;

  @IsOptional()
  @IsNumberString()
  amountMin?: string;

  @IsOptional()
  @IsNumberString()
  amountMax?: string;

  @IsOptional()
  @IsIn(['SEQUENTIAL', 'PARALLEL_ALL', 'PARALLEL_ANY'])
  approveMode?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  slaHours?: number;

  // Who may act on the step once its SLA has elapsed. Either-or, like the approver target; leaving
  // both empty means the step is chased rather than skipped.
  @IsOptional()
  @IsUUID()
  escalateToRoleId?: string;

  @IsOptional()
  @IsUUID()
  escalateToUserId?: string;

  // Whether this step's approval signature is drawn on the exported PDF (default true).
  @IsOptional()
  @IsBoolean()
  showSignatureOnPdf?: boolean;

  // Whether this step may only be APPROVED once the document carries a transfer slip (default
  // false). Gates APPROVE alone — reject and return stay open.
  @IsOptional()
  @IsBoolean()
  requiresPaymentSlip?: boolean;

  // Whether this step's approver may re-code the account a line posts to (default false). Where
  // on the route it is allowed; DOC_LINE_RECODE says who may.
  @IsOptional()
  @IsBoolean()
  allowsAccountRecode?: boolean;

  // Step engagement condition by requester position level, e.g. {"jobLevels":["MANAGER"]}.
  @IsOptional()
  @IsString()
  conditionJson?: string;
}

// Partial update of a step. Every field optional; `workflowId` is not editable (a step
// cannot move between workflows). Same validation rules as create apply on the provided fields.
export class UpdateWorkflowStepDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  stepNo?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  stepName?: string;

  @IsOptional()
  @IsUUID()
  approverRoleId?: string;

  @IsOptional()
  @IsUUID()
  approverUserId?: string;

  @IsOptional()
  @IsNumberString()
  amountMin?: string;

  @IsOptional()
  @IsNumberString()
  amountMax?: string;

  @IsOptional()
  @IsIn(['SEQUENTIAL', 'PARALLEL_ALL', 'PARALLEL_ANY'])
  approveMode?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  slaHours?: number;

  // Who may act on the step once its SLA has elapsed. Either-or, like the approver target; leaving
  // both empty means the step is chased rather than skipped.
  @IsOptional()
  @IsUUID()
  escalateToRoleId?: string;

  @IsOptional()
  @IsUUID()
  escalateToUserId?: string;

  @IsOptional()
  @IsBoolean()
  showSignatureOnPdf?: boolean;

  @IsOptional()
  @IsBoolean()
  requiresPaymentSlip?: boolean;

  @IsOptional()
  @IsBoolean()
  allowsAccountRecode?: boolean;

  @IsOptional()
  @IsString()
  conditionJson?: string;
}

export class CreateDelegationDto {
  @IsUUID()
  delegatorId!: string;

  @IsUUID()
  delegateId!: string;

  @IsOptional()
  @IsUUID()
  documentTypeId?: string;

  @IsOptional()
  @IsNumberString()
  amountLimit?: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}

/**
 * What a person may post to the approval endpoint.
 *
 * Narrowed to `HUMAN_ACTIONS` rather than the whole `ApproveAction` enum: `ESCALATE` belongs to the
 * SLA sweep, and the routing engine writes its `approval_log` row before it interprets the action,
 * so an accepted-but-unhandled value became a history row reading "Escalated (SLA)" on a document
 * whose SLA never elapsed — authored by the approver it excused. The refusal happens here, at
 * validation, before any row exists.
 */
/**
 * The approval inbox's query. `search` is declared HERE rather than taken as a loose `@Query`
 * param because the app runs `forbidNonWhitelisted` — an undeclared property is a 400, not a
 * silently ignored one.
 *
 * It is answered by the server across the WHOLE pending set. The inbox pages, and a search that
 * filtered only the loaded page would be worse than none: a term matching nothing on this page is
 * indistinguishable from a term matching nothing at all.
 */
/**
 * The inbox's search plus its three narrowing filters — department, submitted day range, base
 * amount. Validated as the documents list validates the same fields, so a malformed value is a 400
 * rather than a filter silently ignored. Every one only narrows the caller's actionable set.
 */
export class PendingInboxQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  /** `YYYY-MM-DD` on `submitted_at`; `submittedTo` inclusive to the end of that day. */
  @IsOptional()
  @IsDateString()
  submittedFrom?: string;

  @IsOptional()
  @IsDateString()
  submittedTo?: string;

  /** Inclusive bounds on the base total, as decimal strings — never a JS number. */
  @IsOptional()
  @IsNumberString()
  minAmount?: string;

  @IsOptional()
  @IsNumberString()
  maxAmount?: string;
}

/**
 * The ids on the documents list's visible page, asking which of them this caller may act on.
 *
 * Capped at a page's worth and then some: the answer costs an eligibility resolution per document,
 * and a request naming thousands is not a screen asking about its rows.
 */
export class ActionableDocumentsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  documentIds!: string[];
}

export class ActDto {
  @IsIn(HUMAN_ACTIONS as readonly string[])
  action!: HumanAction;

  @IsOptional()
  @IsString()
  remark?: string;
}

/**
 * The pending-approvals summary's filters. Every field is optional and only narrows what the
 * reader's DOC_VIEW scope already lets them see; a value outside that scope matches nothing.
 * `submittedFrom` / `submittedTo` are calendar days (`YYYY-MM-DD`) in the company's timezone,
 * `submittedTo` inclusive of its whole day — the week a department reports on.
 */
export class PendingSummaryQueryDto {
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  documentTypeId?: string;

  @IsOptional()
  @IsDateString()
  submittedFrom?: string;

  @IsOptional()
  @IsDateString()
  submittedTo?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean()
  overdueOnly?: boolean;
}
