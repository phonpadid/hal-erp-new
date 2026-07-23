import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination';
import { TIME_PATTERN } from '../shift-time';

const TIME_MESSAGE = 'must be a time in HH:MM form';

export class CreateWorkShiftDto {
  @IsString()
  @MaxLength(255)
  code!: string;

  @IsString()
  @MaxLength(255)
  name!: string;

  @Matches(TIME_PATTERN, { message: `startTime ${TIME_MESSAGE}` })
  startTime!: string;

  // An end at or before the start is read as the next day: 22:00-06:00 is a night shift.
  @Matches(TIME_PATTERN, { message: `endTime ${TIME_MESSAGE}` })
  endTime!: string;

  @IsOptional()
  @Matches(TIME_PATTERN, { message: `breakStartTime ${TIME_MESSAGE}` })
  breakStartTime?: string;

  @IsOptional()
  @Matches(TIME_PATTERN, { message: `breakEndTime ${TIME_MESSAGE}` })
  breakEndTime?: string;

  @IsInt()
  @Min(1)
  @Max(1440)
  standardMinutes!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  graceMinutes?: number;

  @IsInt()
  @Min(1)
  @Max(1440)
  halfDayThresholdMinutes!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  otMinMinutes?: number;

  // Rounding block for overtime; 1 means "count every minute".
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(240)
  otRoundMinutes?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateWorkShiftDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @Matches(TIME_PATTERN, { message: `startTime ${TIME_MESSAGE}` })
  startTime?: string;

  @IsOptional()
  @Matches(TIME_PATTERN, { message: `endTime ${TIME_MESSAGE}` })
  endTime?: string;

  // Send null to clear the break.
  @IsOptional()
  @Matches(TIME_PATTERN, { message: `breakStartTime ${TIME_MESSAGE}` })
  breakStartTime?: string | null;

  @IsOptional()
  @Matches(TIME_PATTERN, { message: `breakEndTime ${TIME_MESSAGE}` })
  breakEndTime?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  standardMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  graceMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  halfDayThresholdMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  otMinMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(240)
  otRoundMinutes?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** One weekday of a shift's pattern. Null times mean "use the shift's own". */
export class WorkShiftDayDto {
  // ISO weekday: 1 = Monday ... 7 = Sunday.
  @IsInt()
  @Min(1)
  @Max(7)
  weekday!: number;

  @IsOptional()
  @IsBoolean()
  isWorking?: boolean;

  @IsOptional()
  @Matches(TIME_PATTERN, { message: `startTime ${TIME_MESSAGE}` })
  startTime?: string;

  @IsOptional()
  @Matches(TIME_PATTERN, { message: `endTime ${TIME_MESSAGE}` })
  endTime?: string;
}

/**
 * Replaces a shift's whole weekday pattern. Wholesale rather than per-day because the pattern is
 * one decision ("which days does this shift work, and at what hours") — applying it as a set
 * makes a partial write impossible.
 */
export class SetWorkShiftDaysDto {
  @IsArray()
  @ArrayMinSize(0)
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => WorkShiftDayDto)
  days!: WorkShiftDayDto[];
}

export class ListWorkShiftQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}
