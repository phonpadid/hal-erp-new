import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/**
 * A place in a budget plan — department, category or line.
 *
 * Not a budget: it carries no amount, no status and no approval of its own. The money that sits at
 * a node is a `budget`, and several fiscal years' worth could sit at the same code in different
 * years without this record meaning anything different.
 */
export class CreateBudgetNodeDto {
  @IsUUID()
  fiscalYearId!: string;

  /**
   * The organisation's own code — `1`, `1.1`, `1.101`. It is a label, not a path: depth cannot be
   * parsed from it, since `1.1` is a category and `1.101` a line beneath it and both carry one dot.
   */
  @IsString()
  @MaxLength(255)
  code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  /** Must be a node of the same fiscal year. */
  @IsOptional()
  @IsUUID()
  parentId?: string;
}

/**
 * `code` is absent on purpose. Documents and history refer to a budget by the code of the node its
 * money sits at, so renaming a code would rewrite what those records appear to say.
 */
export class UpdateBudgetNodeDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  /** `null` detaches the node to the root of its department. */
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  /**
   * This place in the plan carries money the whole company draws on: any department may charge a
   * budget at or beneath it. Says who may CHARGE, never who owns — the budgets keep their
   * department.
   */
  @IsOptional()
  @IsBoolean()
  isShared?: boolean;
}
