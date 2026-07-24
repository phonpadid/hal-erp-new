import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import {
  AttendanceDay,
  AttendanceEvent,
  EmployeeShift,
  WorkLocation,
  WorkShift,
  WorkShiftDay,
} from './attendance.entities';
import { EmployeeShiftController, WorkShiftController } from './attendance-shift.controller';
import { AttendanceCaptureController } from './attendance-capture.controller';
import { AttendanceCaptureService } from './attendance-capture.service';
import { AttendanceDayController } from './attendance-day.controller';
import { AttendanceDayService } from './attendance-day.service';
import { EmployeeShiftService } from './employee-shift.service';
import { GeofenceService } from './geofence.service';
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
  imports: [MikroOrmModule.forFeature([
      WorkShift,
      WorkShiftDay,
      EmployeeShift,
      WorkLocation,
      AttendanceEvent,
      AttendanceDay,
    ])],
  controllers: [
    WorkShiftController,
    EmployeeShiftController,
    WorkLocationController,
    AttendanceCaptureController,
    AttendanceDayController,
  ],
  providers: [
    CompanyScopeService,
    WorkShiftService,
    EmployeeShiftService,
    ShiftResolutionService,
    WorkLocationService,
    GeofenceService,
    AttendanceCaptureService,
    AttendanceDayService,
  ],
  exports: [ShiftResolutionService, WorkShiftService],
})
export class AttendanceModule {}
