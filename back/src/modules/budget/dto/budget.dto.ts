import {
  IsEnum,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ControlPolicy } from '../../../common/enums';

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
