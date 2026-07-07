import { IsDateString, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/** Budget-balance report: optionally narrow to a fiscal year and/or department. */
export class BudgetBalanceQueryDto {
  @IsOptional()
  @IsUUID()
  fiscalYearId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;
}

/** Quota-remaining report: optionally pick the entitlement year (defaults to the current cycle). */
export class QuotaRemainingQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(9999)
  year?: number;
}

/** Consolidated group budget-balance report: presentation currency (required) + as-of date. */
export class GroupBudgetBalanceQueryDto {
  @IsString()
  @Length(3, 3)
  currency!: string;

  @IsOptional()
  @IsDateString()
  asOf?: string;
}

/** Document-summary report: optional date range (by created_at) and document type. */
export class DocumentSummaryQueryDto {
  @IsOptional()
  @IsUUID()
  documentTypeId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

/** Spend-by-vendor report: optional date range (by created_at). */
export class SpendByVendorQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

/** Budget-audit report: filter the movement stream by budget/department and a date range. */
export class BudgetAuditQueryDto {
  @IsOptional()
  @IsUUID()
  budgetId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
