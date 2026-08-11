import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ToleranceRungDto } from './control-point.dto';

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

  /**
   * Ladder for the control point this creation may have to mint, in the same shape the
   * control-point API accepts — one vocabulary for "how strictly is this checked" instead of two
   * that need translating at the boundary.
   *
   * Used only when nothing already governs the new budget. Omitted means block at the ceiling,
   * which is what the removed per-budget `HARD_STOP` default meant.
   *
   * The removed `controlPolicy` field is not listed here on purpose: with the app's
   * `forbidNonWhitelisted` validation, a request still sending it is rejected rather than having
   * it silently dropped — a caller that states how spending should be controlled and is quietly
   * overruled believes it configured something it did not.
   */
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ToleranceRungDto)
  tolerance?: ToleranceRungDto[];
}

export class UpdateBudgetDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  budgetName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  status?: string;
  // amountTotal is intentionally NOT updatable here — corrections are ledger
  // adjustments (ADJUST_INCREASE / ADJUST_DECREASE), never an overwrite.
}
