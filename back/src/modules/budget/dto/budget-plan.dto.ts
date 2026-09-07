import {
  ArrayNotEmpty,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreateBudgetDto } from './budget.dto';

/**
 * One proposed budget on a plan. It references a `DRAFT` budget that already exists — a plan
 * gathers lines that were drafted, possibly by different people at different times, which is how
 * an annual budget is actually assembled: departments draft, finance bundles, one signature puts
 * the bundle in force.
 *
 * There is no amount here. The figure lives on `budget.amount_total`, and duplicating it on the
 * line would create two numbers that can disagree with no rule for which wins.
 */
export class BudgetPlanLineDto {
  @IsUUID()
  budgetId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}

export class CreateBudgetPlanDto {
  /**
   * The department the plan is routed through. Every line must target this department or one of
   * its descendants: `document.department_id` is what resolves the form and the workflow, so a
   * line outside that subtree would be approved by people with no authority over it.
   */
  @IsUUID()
  departmentId!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => BudgetPlanLineDto)
  lines!: BudgetPlanLineDto[];

  /** Selects the plan document type when a company has configured more than one. */
  @IsOptional()
  @IsUUID()
  documentTypeId?: string;
}

/**
 * Proposing a budget: the budget's own dimensions plus how the plan carrying it is routed.
 *
 * Extends `CreateBudgetDto` rather than restating it, so the two cannot drift — a field added to
 * one arrives on the other, which is the same failure this whole change is about one layer up.
 * `departmentId` does double duty: it is the budget's department AND the plan's routing
 * department, which trivially satisfies the rule that every line sit in the routing subtree.
 */
export class ProposeBudgetDto extends CreateBudgetDto {
  /** Selects the plan document type when a company has configured more than one. */
  @IsOptional()
  @IsUUID()
  documentTypeId?: string;

  /** The note carried on the plan line, as `budget_movement.reason`. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}

/**
 * Re-proposing a budget that already exists. Everything is optional: the budget itself supplies
 * its department, and a company with one plan type supplies the type.
 */
export class ReproposeBudgetDto {
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  documentTypeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}
