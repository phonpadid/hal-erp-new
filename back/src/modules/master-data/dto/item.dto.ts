import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

// No `itemCode`: the code is issued by MasterSequenceService. The whitelist rejects one if sent.
export class CreateItemDto {
  @IsString()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  defaultUnit?: string;

  /** true = a physical good tracked in a warehouse. Defaults false so nothing changes by accident. */
  @IsOptional()
  @IsBoolean()
  isStockTracked?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateItemDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  defaultUnit?: string;

  @IsOptional()
  @IsBoolean()
  isStockTracked?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/**
 * Per-company enablement options: the BUDGET this item belongs to in the active company.
 *
 * A plan code ("6.101"), resolved server-side against the company's open fiscal year — not an
 * account. One account is charged by many budgets, so an account cannot say which budget was meant,
 * and the account the item posts to is stamped from the budget this names.
 *
 * `''` clears the binding; omitting it leaves the item's binding untouched on a plain re-enable.
 */
export class EnableItemDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  defaultBudgetCode?: string;
}
