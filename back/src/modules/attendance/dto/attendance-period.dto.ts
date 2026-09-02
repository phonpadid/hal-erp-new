import { IsDateString, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AttendancePeriodStatus } from '../../../common/enums';
import { PaginationQueryDto } from '../../../common/pagination/pagination';

export class CreateAttendancePeriodDto {
  /** What people call it, e.g. `2026-07`. The dates below are what the code reads. */
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  code!: string;

  @IsDateString()
  periodStart!: string;

  @IsDateString()
  periodEnd!: string;
}

export class UpdateAttendancePeriodDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  code?: string;

  @IsOptional()
  @IsDateString()
  periodStart?: string;

  @IsOptional()
  @IsDateString()
  periodEnd?: string;
}

export class ReopenPeriodDto {
  /**
   * Required, and validated again in the service and by a check constraint. Reopening a period
   * that may already have been paid should cost a sentence.
   */
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;
}

export class ListAttendancePeriodQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(AttendancePeriodStatus)
  status?: AttendancePeriodStatus;
}
