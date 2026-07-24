import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { LeaveHalf } from '../../../common/enums';

/**
 * A leave request is a range with half-day ends, not a number of days. The days it charges are
 * computed server-side from the employee's shift and the company holidays — a client cannot state
 * them, because a client cannot know which dates are working days for that person.
 */
export class CreateLeaveRequestDto {
  @IsUUID()
  documentId!: string;

  /** The leave type. A leave type IS a quota. */
  @IsUUID()
  quotaId!: string;

  @IsDateString()
  fromDate!: string;

  @IsOptional()
  @IsEnum(LeaveHalf)
  fromHalf?: LeaveHalf;

  @IsDateString()
  toDate!: string;

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
