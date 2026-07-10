import {
  IsDateString,
  IsEnum,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ControlPolicy } from '../../../common/enums';

/**
 * Query for the resolve-budget read: derive a line's budget from its GL. `departmentId`
 * defaults to the requester's active department and `date` to today when omitted, so the
 * common case (creating in your own department, dated now) needs only `glAccount`.
 */
export class ResolveBudgetQueryDto {
  @IsString()
  @MaxLength(255)
  glAccount!: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsDateString()
  date?: string;
}

export class CreateBudgetDto {
  @IsUUID()
  fiscalYearId!: string;

  @IsUUID()
  departmentId!: string;

  @IsString()
  @MaxLength(255)
  glAccount!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  budgetName?: string;

  // DECIMAL carried as a string. Set at creation; never overwritten by usage (invariant 3).
  @IsNumberString()
  amountTotal!: string;

  @IsOptional()
  @IsEnum(ControlPolicy)
  controlPolicy?: ControlPolicy;
}

export class UpdateBudgetDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  budgetName?: string;

  @IsOptional()
  @IsEnum(ControlPolicy)
  controlPolicy?: ControlPolicy;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  status?: string;
  // amountTotal is intentionally NOT updatable here — corrections are ledger
  // adjustments (ADJUST_INCREASE / ADJUST_DECREASE), never an overwrite.
}
