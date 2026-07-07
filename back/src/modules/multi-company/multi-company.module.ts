import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { RbacModule } from '../rbac/rbac.module';
import { CompanyController } from './company.controller';
import { CompanyService } from './company.service';
import { DepartmentController } from './department.controller';
import { DepartmentService } from './department.service';
import { FiscalYearController } from './fiscal-year.controller';
import { FiscalYearService } from './fiscal-year.service';
import { HolidayCalendarController } from './holiday-calendar.controller';
import { HolidayCalendarService } from './holiday-calendar.service';
import {
  Company,
  Department,
  FiscalYear,
  HolidayCalendar,
} from './multi-company.entities';
import { WorkingTimeService } from './working-time.service';

@Module({
  imports: [
    MikroOrmModule.forFeature([Company, Department, FiscalYear, HolidayCalendar]),
    RbacModule, // MembershipService for caller-scoped company listing
  ],
  controllers: [
    CompanyController,
    DepartmentController,
    FiscalYearController,
    HolidayCalendarController,
  ],
  providers: [
    CompanyScopeService,
    CompanyService,
    DepartmentService,
    FiscalYearService,
    HolidayCalendarService,
    WorkingTimeService,
  ],
  exports: [
    CompanyScopeService,
    FiscalYearService,
    WorkingTimeService,
  ],
})
export class MultiCompanyModule {}
