import { leaveRequestCreateSchema } from '@erp/shared';
import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { LeaveHalf } from '../../../common/enums';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import type { LeaveRequestCreateInput } from '@erp/shared';

/**
 * A leave request is a range with half-day ends, not a number of days. The days it charges are
 * computed server-side from the employee's shift and the company holidays — a client cannot state
 * them, because a client cannot know which dates are working days for that person.
 *
 * Validated by the SHARED schema, so the Vue form and this endpoint enforce one set of rules. The
 * reversed-range check is why sharing pays here: it spans two fields, and a form that could not
 * see it would only learn about it from a 400.
 */
export type CreateLeaveRequestDto = LeaveRequestCreateInput;
export const CreateLeaveRequestValidationPipe = new ZodValidationPipe(leaveRequestCreateSchema);

/** Count a candidate range for the CALLER. Carries no employee id: the account decides. */
export class PreviewOwnLeaveQueryDto {
  @IsDateString()
  fromDate!: string;

  @IsDateString()
  toDate!: string;

  @IsOptional()
  @IsEnum(LeaveHalf)
  fromHalf?: LeaveHalf;

  @IsOptional()
  @IsEnum(LeaveHalf)
  toHalf?: LeaveHalf;
}

/** Count a candidate range without committing to it. */
export class PreviewLeaveQueryDto {
  @IsUUID()
  employeeId!: string;

  @IsDateString()
  fromDate!: string;

  @IsDateString()
  toDate!: string;

  @IsOptional()
  @IsEnum(LeaveHalf)
  fromHalf?: LeaveHalf;

  @IsOptional()
  @IsEnum(LeaveHalf)
  toHalf?: LeaveHalf;
}
