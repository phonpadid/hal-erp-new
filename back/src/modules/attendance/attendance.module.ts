import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { EmployeeShift, WorkLocation, WorkShift, WorkShiftDay } from './attendance.entities';
import { EmployeeShiftController, WorkShiftController } from './attendance-shift.controller';
import { EmployeeShiftService } from './employee-shift.service';
import { ShiftResolutionService } from './shift-resolution.service';
import { WorkShiftService } from './work-shift.service';
import { WorkLocationController } from './work-location.controller';
import { WorkLocationService } from './work-location.service';

/**
 * Attendance foundation: what the company expects of an employee — shifts, who works which one,
 * and where work happens. No time records yet.
 *
 * Exports ShiftResolutionService because every later attendance slice starts by asking what was
 * expected of a person on a date; that question should have exactly one implementation.
 */
@Module({
  imports: [MikroOrmModule.forFeature([WorkShift, WorkShiftDay, EmployeeShift, WorkLocation])],
  controllers: [WorkShiftController, EmployeeShiftController, WorkLocationController],
  providers: [
    CompanyScopeService,
    WorkShiftService,
    EmployeeShiftService,
    ShiftResolutionService,
    WorkLocationService,
  ],
  exports: [ShiftResolutionService, WorkShiftService],
})
export class AttendanceModule {}
