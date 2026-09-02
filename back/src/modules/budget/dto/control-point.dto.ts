import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * One rung of a tolerance ladder. `at` is the percentage of the ceiling at which the rung starts
 * applying; every rung that is reached applies, and a reached BLOCK beats a reached WARN, so the
 * order rungs are sent in cannot change the outcome.
 *
 * ESCALATE is deliberately absent: adding a step to a running approval chain belongs to
 * approval-workflow, not here.
 */
export class ToleranceRungDto {
  @IsInt()
  @Min(0)
  at!: number;

  @IsIn(['WARN', 'BLOCK'])
  action!: 'WARN' | 'BLOCK';
}

export class CreateControlPointDto {
  @IsUUID()
  fiscalYearId!: string;

  /** Any node of the BUDGET tree — leaf or parent. A control point is a checkpoint, never a
   *  posting target, so nothing about where budgets are charged restricts where it may sit. */
  @IsUUID()
  budgetNodeId!: string;

  @IsUUID()
  departmentNodeId!: string;

  // An empty ladder would check nothing while looking configured, so it is rejected here rather
  // than interpreted permissively at check time.
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ToleranceRungDto)
  tolerance!: ToleranceRungDto[];

  /**
   * Reserved. Must be null: a node ceiling that differs from the rollup of the budgets it governs
   * needs a parent/child reconciliation rule that does not exist yet. The service rejects any
   * non-null value; the column exists so enabling it later needs no second migration.
   */
  @IsOptional()
  capAmount?: null;
}

export class UpdateControlPointDto {
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ToleranceRungDto)
  tolerance?: ToleranceRungDto[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  capAmount?: null;
}

export class ListControlPointsQueryDto {
  @IsOptional()
  @IsUUID()
  fiscalYearId?: string;
}
