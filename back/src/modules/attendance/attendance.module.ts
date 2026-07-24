import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import {
  AttendanceDay,
  AttendanceEvent,
  AttendancePeriod,
  AttendancePeriodLeave,
  AttendancePeriodLine,
  AttendancePeriodLog,
  EmployeeShift,
  LeaveRequest,
  LeaveType,
  OvertimeClaim,
  TimeCorrection,
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
import { LeaveApprovedListener } from './leave-approved.listener';
import { LeaveRequestController } from './leave-request.controller';
import { LeaveRequestService } from './leave-request.service';
import { LeaveTypeService } from './leave-type.service';
import { OvertimeClaimController } from './overtime-claim.controller';
import { OvertimeClaimService } from './overtime-claim.service';
import { GeofenceService } from './geofence.service';
import { ShiftResolutionService } from './shift-resolution.service';
import { AttendancePeriodController } from './attendance-period.controller';
import { AttendancePeriodGuard } from './attendance-period.guard';
import { AttendancePeriodService } from './attendance-period.service';
import { CorrectionApprovedListener } from './correction-approved.listener';
import { TimeCorrectionController } from './time-correction.controller';
import { TimeCorrectionService } from './time-correction.service';
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
      LeaveRequest,
      LeaveType,
      OvertimeClaim,
      TimeCorrection,
      AttendancePeriod,
      AttendancePeriodLine,
      AttendancePeriodLeave,
      AttendancePeriodLog,
    ])],
  controllers: [
    WorkShiftController,
    EmployeeShiftController,
    WorkLocationController,
    AttendanceCaptureController,
    AttendanceDayController,
    LeaveRequestController,
    OvertimeClaimController,
    TimeCorrectionController,
    AttendancePeriodController,
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
    LeaveRequestService,
    LeaveApprovedListener,
    LeaveTypeService,
    OvertimeClaimService,
    TimeCorrectionService,
    CorrectionApprovedListener,
    AttendancePeriodGuard,
    AttendancePeriodService,
  ],
  exports: [ShiftResolutionService, WorkShiftService, AttendancePeriodGuard],
})
export class AttendanceModule {}
