import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { ApproveAction } from '../../../common/enums';

export class CreateWorkflowDto {
  @IsString()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  conditionJson?: string;
}

// Partial update of a workflow's own attributes (not its steps). All fields optional.
export class UpdateWorkflowDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  conditionJson?: string;

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

  // Whether this step's approval signature is drawn on the exported PDF (default true).
  @IsOptional()
  @IsBoolean()
  showSignatureOnPdf?: boolean;

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

  @IsOptional()
  @IsBoolean()
  showSignatureOnPdf?: boolean;

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

export class ActDto {
  @IsEnum(ApproveAction)
  action!: ApproveAction;

  @IsOptional()
  @IsString()
  remark?: string;
}
