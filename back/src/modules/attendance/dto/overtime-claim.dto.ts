import { IsDateString, IsUUID } from 'class-validator';

/**
 * A claim names an employee and a range of shift days. It does NOT carry hours — those are summed
 * from `attendance_day`, because a quantity the system derives is not the claimant's to state.
 */
export class CreateOvertimeClaimDto {
  @IsUUID()
  documentId!: string;

  @IsUUID()
  employeeId!: string;

  @IsDateString()
  fromDate!: string;

  @IsDateString()
  toDate!: string;
}

/** What a candidate range would certify, without committing to it. */
export class PreviewOvertimeQueryDto {
  @IsUUID()
  employeeId!: string;

  @IsDateString()
  fromDate!: string;

  @IsDateString()
  toDate!: string;
}
