import { Module } from '@nestjs/common';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ApprovalWorkflowModule } from '../approval/approval-workflow.module';
import { BudgetControlModule } from '../budget/budget-control.module';
import { MultiCurrencyModule } from '../currency/multi-currency.module';
import { QuotaManagementModule } from '../quota/quota-management.module';
import { ScopeService } from '../rbac/scope.service';
import { GroupReportingService } from './group-reporting.service';
import { ReportingController } from './reporting.controller';
import { ReportingService } from './reporting.service';

/**
 * Read-only reporting layer. Reuses the balance/approval/quota/currency services (imported from
 * their modules) and adds only aggregation + endpoints — no new entities, no writes. The group
 * report additionally reads across companies (GROUP scope only, enforced in the service).
 */
@Module({
  imports: [BudgetControlModule, ApprovalWorkflowModule, QuotaManagementModule, MultiCurrencyModule],
  controllers: [ReportingController],
  providers: [CompanyScopeService, ScopeService, ReportingService, GroupReportingService],
})
export class ReportingModule {}
