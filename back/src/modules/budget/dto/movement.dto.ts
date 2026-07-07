import { IsIn, IsNotEmpty, IsNumberString, IsString, IsUUID } from 'class-validator';

export class ExecuteTransferDto {
  @IsUUID()
  documentId!: string;

  @IsUUID()
  fromBudgetId!: string;

  @IsUUID()
  toBudgetId!: string;

  @IsNumberString()
  amount!: string;
}

export class ExecuteAdjustmentDto {
  @IsUUID()
  documentId!: string;

  @IsUUID()
  budgetId!: string;

  @IsNumberString()
  amount!: string;

  @IsIn(['ADJUST_INCREASE', 'ADJUST_DECREASE'])
  movementType!: 'ADJUST_INCREASE' | 'ADJUST_DECREASE';
}

/**
 * Create a budget adjustment as an approvable document (spec: budget adjustment SHALL
 * be an approvable document). `budgetId` comes from the path param; `direction` picks
 * the adjustment document type whose `post_action` writes the ADJUST on approval.
 */
export class CreateAdjustmentDto {
  @IsIn(['INCREASE', 'DECREASE'])
  direction!: 'INCREASE' | 'DECREASE';

  @IsNumberString()
  amount!: string;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}

/**
 * Create a budget transfer as an approvable document (spec: budget transfer SHALL be an
 * approvable document). The paired TRANSFER_OUT/TRANSFER_IN is written by the post-action
 * on full approval — this intake only creates the document + budget_movement (no budget_txn).
 */
export class CreateTransferDto {
  @IsUUID()
  fromBudgetId!: string;

  @IsUUID()
  toBudgetId!: string;

  @IsNumberString()
  amount!: string;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}
