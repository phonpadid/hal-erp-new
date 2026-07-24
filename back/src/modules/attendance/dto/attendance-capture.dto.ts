import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { AttendanceDirection, AttendanceSource, GeofenceStatus } from '../../../common/enums';
import { PaginationQueryDto } from '../../../common/pagination/pagination';

/** The two sources a person may claim for themselves. MANUAL is stamped, never accepted. */
const SELF_SOURCES = [AttendanceSource.WEB, AttendanceSource.MOBILE] as const;

/**
 * Self-service punch. Carries NO employee id and NO timestamp — the employee comes from the
 * caller's own account and the instant from the server clock. That absence is the security
 * property: there is no field here that a validation bug could turn into an impersonation route.
 */
export class PunchSelfDto {
  @IsOptional()
  @IsIn(SELF_SOURCES)
  source?: AttendanceSource;

  // Coordinates as decimal strings, never JS numbers — a geofence decision should not inherit
  // binary rounding. Both or neither: half a fix is not a position.
  @IsOptional()
  @ValidateIf((o) => o.latitude !== undefined || o.longitude !== undefined)
  @IsNumberString({ no_symbols: false }, { message: 'latitude must be a decimal string' })
  latitude?: string;

  @IsOptional()
  @ValidateIf((o) => o.latitude !== undefined || o.longitude !== undefined)
  @IsNumberString({ no_symbols: false }, { message: 'longitude must be a decimal string' })
  longitude?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  deviceId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remark?: string;
}

/**
 * Recording a punch for someone else. Requires ATTEND_PUNCH_MANAGE, always stamps source MANUAL
 * and the acting user in `recordedBy`. `occurredAt` may be in the past: a backdating limit
 * belongs with period close, which does not exist yet.
 */
export class PunchForEmployeeDto {
  @IsUUID()
  employeeId!: string;

  @IsDateString()
  occurredAt!: string;

  @IsEnum(AttendanceDirection)
  direction!: AttendanceDirection;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remark?: string;
}

/** One direction and one instant for a whole crew — "check the team in at 08:00". */
export class BulkPunchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  employeeIds!: string[];

  @IsDateString()
  occurredAt!: string;

  @IsEnum(AttendanceDirection)
  direction!: AttendanceDirection;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remark?: string;
}

export class ListAttendanceEventQueryDto extends PaginationQueryDto {
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
  @IsEnum(AttendanceSource)
  source?: AttendanceSource;

  @IsOptional()
  @IsEnum(GeofenceStatus)
  geofenceStatus?: GeofenceStatus;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  manualOnly?: boolean;
}

/** The self-service read: one local date, always the caller's own events. */
export class OwnEventsQueryDto {
  @IsOptional()
  @IsDateString()
  date?: string;
}
