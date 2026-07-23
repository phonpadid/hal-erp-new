import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class AssignEmployeeShiftDto {
  @IsUUID()
  employeeId!: string;

  @IsUUID()
  workShiftId!: string;

  @IsDateString()
  effectiveFrom!: string;

  // Null/absent means open-ended.
  @IsOptional()
  @IsDateString()
  effectiveTo?: string;
}

/** Close an open-ended assignment, or move its end date. */
export class EndEmployeeShiftDto {
  @IsDateString()
  effectiveTo!: string;
}
