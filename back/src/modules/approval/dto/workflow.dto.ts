import {
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
export class PendingInboxQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class ActDto {
  @IsIn(HUMAN_ACTIONS as readonly string[])
  action!: HumanAction;

  @IsOptional()
  @IsString()
  remark?: string;
}
