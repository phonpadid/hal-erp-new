import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import { AssignEmployeeShiftDto, EndEmployeeShiftDto } from './dto/employee-shift.dto';
import {
  CreateWorkShiftDto,
  ListWorkShiftQueryDto,
  SetWorkShiftDaysDto,
  UpdateWorkShiftDto,
} from './dto/work-shift.dto';
import { EmployeeShiftService } from './employee-shift.service';
import { AttendancePermissions as P } from './permissions';
import { ShiftResolutionService } from './shift-resolution.service';
import { WorkShiftService } from './work-shift.service';

@Controller('work-shifts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class WorkShiftController {
  constructor(
    private readonly shifts: WorkShiftService,
    private readonly assignments: EmployeeShiftService,
    private readonly resolution: ShiftResolutionService,
  ) {}

  @Post()
  @RequirePermissions(P.ATTEND_SHIFT_MANAGE)
  create(@Body() dto: CreateWorkShiftDto) {
    return this.shifts.create(dto);
  }

  @Get()
  @RequirePermissions(P.ATTEND_SHIFT_READ)
  list(@Query() q: ListWorkShiftQueryDto) {
    return this.shifts.list(q, q.includeInactive ?? false);
  }

  // Active shifts for the assignment picker.
  @Get('selectable')
  @RequirePermissions(P.ATTEND_SHIFT_READ)
  listSelectable() {
    return this.shifts.listSelectable();
  }

  /**
   * What is expected of an employee on a date. Returns null when nothing is — an employee with
   * no assignment and no department default is a legitimate state, not a 404.
   */
  @Get('resolve/:employeeId/:date')
  @RequirePermissions(P.ATTEND_SHIFT_READ)
  resolve(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Param('date') date: string,
  ) {
    return this.resolution.resolve(employeeId, date);
  }

  @Get(':id')
  @RequirePermissions(P.ATTEND_SHIFT_READ)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.shifts.get(id);
  }

  @Patch(':id')
  @RequirePermissions(P.ATTEND_SHIFT_MANAGE)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateWorkShiftDto) {
    return this.shifts.update(id, dto);
  }

  @Get(':id/days')
  @RequirePermissions(P.ATTEND_SHIFT_READ)
  getDays(@Param('id', ParseUUIDPipe) id: string) {
    return this.shifts.getDays(id);
  }

  // PUT, not PATCH: the weekday pattern is replaced as a whole, so a partial write is impossible.
  @Put(':id/days')
  @RequirePermissions(P.ATTEND_SHIFT_MANAGE)
  setDays(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetWorkShiftDaysDto) {
    return this.shifts.setDays(id, dto);
  }

  // Soft-delete (deactivate) — the default, keeping existing assignments resolvable.
  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(P.ATTEND_SHIFT_MANAGE)
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.shifts.deactivate(id);
  }

  // Hard-delete — rejected while the shift is still assigned or is a department default.
  @Delete(':id/hard')
  @HttpCode(204)
  @RequirePermissions(P.ATTEND_SHIFT_MANAGE)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.shifts.remove(id);
  }
}

@Controller('employee-shifts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class EmployeeShiftController {
  constructor(private readonly assignments: EmployeeShiftService) {}

  @Post()
  @RequirePermissions(P.ATTEND_SHIFT_MANAGE)
  assign(@Body() dto: AssignEmployeeShiftDto) {
    return this.assignments.assign(dto);
  }

  @Get('employee/:employeeId')
  @RequirePermissions(P.ATTEND_SHIFT_READ)
  listForEmployee(@Param('employeeId', ParseUUIDPipe) employeeId: string) {
    return this.assignments.listForEmployee(employeeId);
  }

  @Patch(':id/end')
  @RequirePermissions(P.ATTEND_SHIFT_MANAGE)
  end(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EndEmployeeShiftDto) {
    return this.assignments.end(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(P.ATTEND_SHIFT_MANAGE)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.assignments.remove(id);
  }
}
