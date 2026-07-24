import { punchSelfSchema } from '@erp/shared';
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
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import type { PunchSelfInput } from '@erp/shared';

/**
 * Self-service punch. Carries NO employee id and NO timestamp — the employee comes from the
 * caller's own account and the instant from the server clock. That absence is the security
 * property: there is no field here that a validation bug could turn into an impersonation route.
 *
 * Validated by the SHARED schema rather than by class-validator, so the Vue form's resolver and
 * this endpoint enforce one set of rules instead of two copies that drift. The both-or-neither
 * coordinate rule is the reason it matters: it is a refinement across two fields, and two
 * frameworks expressing it separately would eventually disagree about half a fix.
 */
export type PunchSelfDto = PunchSelfInput;
export const PunchSelfValidationPipe = new ZodValidationPipe(punchSelfSchema);

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
