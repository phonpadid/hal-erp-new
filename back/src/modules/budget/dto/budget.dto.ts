import {
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { BUDGET_STATUSES } from '@erp/shared';
import { SearchablePaginationQueryDto } from '../../../common/pagination/pagination';

export class CreateBudgetDto {
  @IsUUID()
  fiscalYearId!: string;

  @IsUUID()
  departmentId!: string;

  /**
   * Where in the plan this money sits. The node is the budget's identity — the GL account cannot
   * be, since several budgets legitimately share one and one budget posts to several.
   */
  @IsUUID()
  nodeId!: string;

  /**
   * Optional, and no longer an identity. A budget whose spending posts to several accounts — loan
   * principal and interest, say — names none, because naming one of them would be false.
   */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  glAccount?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  budgetName?: string;

  // DECIMAL carried as a string. Set at creation; never overwritten by usage (invariant 3).
  @IsNumberString()
  amountTotal!: string;

  // Neither `tolerance` nor the older `controlPolicy` is declared here, on purpose. Creation no
  // longer mints a control point — coverage is established when a budget plan is approved — so
  // there is no point at this moment for a ladder to belong to, and nowhere to hold a proposed one
  // that would not be a value meaningless the moment it was used. Ladders are configured on the
  // control point itself.
  //
  // Leaving them undeclared is what REJECTS them: the app's `forbidNonWhitelisted` validation
  // turns an undeclared property into a 400 rather than silently dropping it. A caller that states
  // how spending should be controlled and is quietly overruled believes it configured something it
  // did not.
}

export class UpdateBudgetDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  budgetName?: string;

  /**
   * The account hint may be corrected: it is a hint, not the identity. An empty string clears it,
   * which is what a budget that turns out to post to several accounts needs.
   */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  glAccount?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  status?: string;

  /**
   * The owning department. Correctable, unlike the node and the fiscal year, which are the
   * budget's identity — a department is a fact about the organisation, and organisations
   * reorganise. Moving it re-governs the budget: see `BudgetService.update`.
   */
  @IsOptional()
  @IsUUID()
  departmentId?: string;
  // amountTotal is intentionally NOT updatable here — corrections are ledger
  // adjustments (ADJUST_INCREASE / ADJUST_DECREASE), never an overwrite.
}


/**
 * The budget list's query: paging, a search term, and the two dimensions a reader narrows by.
 *
 * Both filters are optional and NEITHER has a default. Defaulting `status` to ACTIVE would hide the
 * proposals a plan had turned down, which is a decision about what a budget list means and not one
 * to make silently on the customer's behalf — the screen states what it is hiding instead.
 *
 * `status` is validated against the declared list rather than accepted as any string: an endpoint
 * that takes a value it cannot act on tells the caller their request was understood when it was
 * not.
 */
export class BudgetListQueryDto extends SearchablePaginationQueryDto {
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsIn([...BUDGET_STATUSES])
  status?: string;
}
