import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import { AttendancePeriodService } from './attendance-period.service';
import { AttendancePermissions } from './permissions';
import {
  CreateAttendancePeriodDto,
  ListAttendancePeriodQueryDto,
  ReopenPeriodDto,
  UpdateAttendancePeriodDto,
} from './dto/attendance-period.dto';

@Controller('attendance-periods')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AttendancePeriodController {
  constructor(private readonly periods: AttendancePeriodService) {}

  @Get()
  @RequirePermissions(AttendancePermissions.ATTEND_PERIOD_READ)
  list(@Query() q: ListAttendancePeriodQueryDto) {
    return this.periods.list(q);
  }

  /**
   * Punches recorded for dates already closed. Gated on reading periods rather than on reading
   * punches: the question it answers is about the period, and the punches are the answer.
   */
  @Get('closed-events')
  @RequirePermissions(AttendancePermissions.ATTEND_PERIOD_READ)
  closedEvents() {
    return this.periods.eventsInClosedPeriods();
  }

  @Get(':periodId/lines')
  @RequirePermissions(AttendancePermissions.ATTEND_PERIOD_READ)
  lines(@Param('periodId', ParseUUIDPipe) periodId: string) {
    return this.periods.lines(periodId);
  }

  @Get('lines/:lineId/leave')
  @RequirePermissions(AttendancePermissions.ATTEND_PERIOD_READ)
  lineLeave(@Param('lineId', ParseUUIDPipe) lineId: string) {
    return this.periods.leaveOf(lineId);
  }

  @Get(':periodId/log')
  @RequirePermissions(AttendancePermissions.ATTEND_PERIOD_READ)
  log(@Param('periodId', ParseUUIDPipe) periodId: string) {
    return this.periods.log(periodId);
  }

  @Post()
  @RequirePermissions(AttendancePermissions.ATTEND_PERIOD_MANAGE)
  declare(@Body() dto: CreateAttendancePeriodDto) {
    return this.periods.declare(dto);
  }

  @Put(':periodId')
  @RequirePermissions(AttendancePermissions.ATTEND_PERIOD_MANAGE)
  update(@Param('periodId', ParseUUIDPipe) periodId: string, @Body() dto: UpdateAttendancePeriodDto) {
    return this.periods.update(periodId, dto);
  }

  /** Freeze the range and snapshot every employee's totals. */
  @Post(':periodId/close')
  @RequirePermissions(AttendancePermissions.ATTEND_PERIOD_CLOSE)
  close(@Param('periodId', ParseUUIDPipe) periodId: string) {
    return this.periods.close(periodId);
  }

  /** Its own code, not the closing one: this reaches into a period that may already be paid. */
  @Post(':periodId/reopen')
  @RequirePermissions(AttendancePermissions.ATTEND_PERIOD_REOPEN)
  reopen(@Param('periodId', ParseUUIDPipe) periodId: string, @Body() dto: ReopenPeriodDto) {
    return this.periods.reopen(periodId, dto);
  }
}
