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

/** Recompute one date for every employee of the active company. */
export class RecomputeCompanyDateDto {
  @IsDateString()
  date!: string;
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
