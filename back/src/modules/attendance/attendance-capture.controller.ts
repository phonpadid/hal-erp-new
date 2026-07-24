import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import { AttendanceDirection } from '../../common/enums';
import { AttendanceCaptureService } from './attendance-capture.service';
import {
  BulkPunchDto,
  ListAttendanceEventQueryDto,
  OwnEventsQueryDto,
  PunchForEmployeeDto,
  PunchSelfValidationPipe,
  type PunchSelfDto,
} from './dto/attendance-capture.dto';
import { AttendancePermissions as P } from './permissions';

@Controller('attendance')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AttendanceCaptureController {
  constructor(private readonly capture: AttendanceCaptureService) {}

  /**
   * Punch as yourself. Note what is absent from the signature: no employee id, no timestamp. The
   * DTO cannot carry them either, so there is no code path here that could punch for someone else
   * however the body is crafted.
   */
  @Post('check-in')
  @RequirePermissions(P.ATTEND_PUNCH_SELF)
  checkIn(@Body(PunchSelfValidationPipe) dto: PunchSelfDto) {
    return this.capture.punchSelf(AttendanceDirection.IN, dto);
  }

  @Post('check-out')
  @RequirePermissions(P.ATTEND_PUNCH_SELF)
  checkOut(@Body(PunchSelfValidationPipe) dto: PunchSelfDto) {
    return this.capture.punchSelf(AttendanceDirection.OUT, dto);
  }

  // Record for another employee — always stamped MANUAL with the acting user.
  @Post('events')
  @RequirePermissions(P.ATTEND_PUNCH_MANAGE)
  punchFor(@Body() dto: PunchForEmployeeDto) {
    return this.capture.punchFor(dto);
  }

  // Roll call: one direction and instant for a crew, all-or-nothing.
  @Post('events/bulk')
  @RequirePermissions(P.ATTEND_PUNCH_MANAGE)
  bulkPunch(@Body() dto: BulkPunchDto) {
    return this.capture.bulkPunch(dto);
  }

  /**
   * The caller's own punches for a local date. Declared BEFORE the general list so the static
   * 'events/me' path is matched here rather than being swallowed by the broader route.
   */
  @Get('events/me')
  @RequirePermissions(P.ATTEND_PUNCH_SELF)
  listOwn(@Query() q: OwnEventsQueryDto) {
    return this.capture.listOwn(q.date);
  }

  @Get('events')
  @RequirePermissions(P.ATTEND_PUNCH_READ)
  list(@Query() q: ListAttendanceEventQueryDto) {
    return this.capture.list(q);
  }
}
