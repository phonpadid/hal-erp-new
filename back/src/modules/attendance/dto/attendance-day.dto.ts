import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { AttendanceDayStatus } from '../../../common/enums';
import { PaginationQueryDto } from '../../../common/pagination/pagination';

/** Recompute one employee over one date or a range; omit `dateTo` for a single day. */
export class RecomputeDaysDto {
  @IsUUID()
  employeeId!: string;

  @IsDateString()
  dateFrom!: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}

/**
 * Recompute a date RANGE for every employee of the active company.
 *
 * `dateTo` is optional and absent means `dateFrom` alone, which is exactly what this DTO used to
 * mean — so a caller that predates ranges keeps working unchanged. The same shape
 * `RecomputeDaysDto` already uses for one employee.
 */
export class RecomputeCompanyDateDto {
  @IsDateString()
  dateFrom!: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}

export class ListAttendanceDayQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsEnum(AttendanceDayStatus)
  status?: AttendanceDayStatus;
}
