import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import { AttendanceDayService } from './attendance-day.service';
import {
  ListAttendanceDayQueryDto,
  RecomputeCompanyDateDto,
  RecomputeDaysDto,
} from './dto/attendance-day.dto';
import { AttendancePermissions as P } from './permissions';

@Controller('attendance/days')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AttendanceDayController {
  constructor(private readonly days: AttendanceDayService) {}

  /**
   * Rebuild one employee's days. Separate from the company-wide route because the two have
   * different blast radii and deserve to be distinguishable in an audit log.
   */
  @Post('recompute')
  @RequirePermissions(P.ATTEND_DAY_RECOMPUTE)
  recompute(@Body() dto: RecomputeDaysDto) {
    return this.days.recomputeRange(dto.employeeId, dto.dateFrom, dto.dateTo ?? dto.dateFrom);
  }

  @Post('recompute/company')
  @RequirePermissions(P.ATTEND_DAY_RECOMPUTE)
  async recomputeCompany(@Body() dto: RecomputeCompanyDateDto) {
    const dateFrom = dto.dateFrom.slice(0, 10);
    const dateTo = (dto.dateTo ?? dto.dateFrom).slice(0, 10);
    // `employeeDays`, not `employees`: over a range the two are different numbers, and the caller
    // is watching how much work happened rather than how many people it touched.
    const employeeDays = await this.days.recomputeCompanyRange(dateFrom, dateTo);
    return { dateFrom, dateTo, employeeDays };
  }

  /**
   * The caller's own days. Declared BEFORE the general list so the static 'me' path is matched
   * here rather than being swallowed by the broader route.
   *
   * Gated on ATTEND_DAY_SELF, not ATTEND_DAY_READ: reading your own attendance must not require the
   * power to read everybody's. `listOwn` resolves the employee from the account, so any employee
   * identifier in the query is ignored rather than honoured.
   */
  @Get('me')
  @RequirePermissions(P.ATTEND_DAY_SELF)
  listOwn(@Query() q: ListAttendanceDayQueryDto) {
    return this.days.listOwn(q);
  }

  @Get()
  @RequirePermissions(P.ATTEND_DAY_READ)
  list(@Query() q: ListAttendanceDayQueryDto) {
    return this.days.list(q);
  }
}
