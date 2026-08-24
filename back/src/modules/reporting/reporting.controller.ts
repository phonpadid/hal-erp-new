import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import { toCsv } from './csv';
import { BudgetLedgerReconciliationService } from './budget-ledger-reconciliation.service';
import {
  BudgetAuditQueryDto,
  BudgetBalanceQueryDto,
  BudgetLedgerReconciliationQueryDto,
  DocumentSummaryQueryDto,
  GroupBudgetBalanceQueryDto,
  QuotaRemainingQueryDto,
  SpendByVendorQueryDto,
} from './dto/report-filters.dto';
import { GroupReportingService } from './group-reporting.service';
import { ReportingPermissions as P } from './permissions';
import { BudgetQuarterService } from './budget-quarter.service';
import { ReportingService } from './reporting.service';

/** Read-only operational reports for the active company. All endpoints require REPORT_VIEW. */
@Controller('reports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReportingController {
  constructor(
    private readonly reports: ReportingService,
    private readonly quarters: BudgetQuarterService,
    private readonly groupReports: GroupReportingService,
    private readonly reconciliation: BudgetLedgerReconciliationService,
  ) {}

  @Get('budget-balance')
  @RequirePermissions(P.REPORT_VIEW)
  budgetBalance(@Query() q: BudgetBalanceQueryDto) {
    return this.reports.budgetBalanceByDeptCategory(q);
  }

  @Get('approval-aging')
  @RequirePermissions(P.REPORT_VIEW)
  approvalAging() {
    return this.reports.approvalAging();
  }

  @Get('quota-remaining')
  @RequirePermissions(P.REPORT_VIEW)
  quotaRemaining(@Query() q: QuotaRemainingQueryDto) {
    return this.reports.quotaRemaining(q);
  }

  @Get('budget-audit')
  @RequirePermissions(P.REPORT_VIEW)
  budgetAudit(@Query() q: BudgetAuditQueryDto) {
    return this.reports.budgetAudit(q);
  }

  @Get('document-summary')
  @RequirePermissions(P.REPORT_VIEW)
  documentSummary(@Query() q: DocumentSummaryQueryDto) {
    return this.reports.documentSummary(q);
  }

  @Get('spend-by-vendor')
  @RequirePermissions(P.REPORT_VIEW)
  spendByVendor(@Query() q: SpendByVendorQueryDto) {
    return this.reports.spendByVendor(q);
  }

  @Get('budget-utilization')
  @RequirePermissions(P.REPORT_VIEW)
  budgetUtilization(@Query() q: BudgetBalanceQueryDto) {
    return this.reports.budgetUtilization(q);
  }

  /**
   * Budget consumption by quarter of a fiscal year, with each quarter compared against the one
   * before it. A read: it adds nothing to the ledger and gates nothing.
   */
  @Get('budget-by-quarter')
  @RequirePermissions(P.REPORT_VIEW)
  budgetByQuarter(@Query() q: BudgetBalanceQueryDto) {
    return this.quarters.byQuarter(q.fiscalYearId, q.departmentId);
  }

  /**
   * What the budget says and what the ledger says, per account, for one fiscal year — with the
   * difference decomposed until nothing is unexplained. Derived on read; writes nothing.
   */
  @Get('budget-ledger-reconciliation')
  @RequirePermissions(P.REPORT_VIEW)
  budgetLedgerReconciliation(@Query() q: BudgetLedgerReconciliationQueryDto) {
    return this.reconciliation.reconcile(q);
  }

  // Consolidated cross-company report. The code guard checks presence; the service enforces
  // that REPORT_GROUP_VIEW is held at GROUP scope before any cross-company read.
  @Get('group/budget-balance')
  @RequirePermissions(P.REPORT_GROUP_VIEW)
  groupBudgetBalance(@Query() q: GroupBudgetBalanceQueryDto) {
    return this.groupReports.consolidatedBudgetBalance(q);
  }

  // ---- CSV export ------------------------------------------------------------------------
  // Each export reuses the same service method, permission code, scope, and filters as the
  // on-screen report, so the file can never contain rows the caller may not see. Money stays a
  // decimal string in the CSV (the column extractors never coerce to a JS number).

  @Get('budget-audit/export')
  @RequirePermissions(P.REPORT_VIEW)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="budget-audit.csv"')
  async budgetAuditCsv(@Query() q: BudgetAuditQueryDto): Promise<string> {
    const rows = await this.reports.budgetAudit(q);
    return toCsv(
      [
        { header: 'createdAt', value: (r) => r.createdAt?.toISOString() ?? '' },
        { header: 'txnType', value: (r) => r.txnType },
        { header: 'category', value: (r) => r.category },
        { header: 'department', value: (r) => r.departmentName },
        { header: 'amount', value: (r) => r.amount },
        { header: 'documentNo', value: (r) => r.documentNo ?? '' },
        { header: 'actor', value: (r) => r.actorName ?? '' },
        { header: 'remark', value: (r) => r.remark ?? '' },
      ],
      rows,
    );
  }

  @Get('quota-remaining/export')
  @RequirePermissions(P.REPORT_VIEW)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="quota-remaining.csv"')
  async quotaRemainingCsv(@Query() q: QuotaRemainingQueryDto): Promise<string> {
    const rows = await this.reports.quotaRemaining(q);
    return toCsv(
      [
        { header: 'quotaType', value: (r) => r.quotaType },
        { header: 'unit', value: (r) => r.unit },
        { header: 'department', value: (r) => r.departmentName ?? '' },
        { header: 'employee', value: (r) => r.employeeName },
        { header: 'year', value: (r) => r.year },
        { header: 'entitled', value: (r) => r.entitled },
        { header: 'used', value: (r) => r.used },
        { header: 'remaining', value: (r) => r.remaining },
      ],
      rows,
    );
  }

  @Get('document-summary/export')
  @RequirePermissions(P.REPORT_VIEW)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="document-summary.csv"')
  async documentSummaryCsv(@Query() q: DocumentSummaryQueryDto): Promise<string> {
    const { rows } = await this.reports.documentSummary(q);
    return toCsv(
      [
        { header: 'typeCode', value: (r) => r.typeCode },
        { header: 'typeName', value: (r) => r.typeName },
        { header: 'category', value: (r) => r.category },
        { header: 'status', value: (r) => r.status },
        { header: 'count', value: (r) => r.count },
        { header: 'baseTotal', value: (r) => r.baseTotal },
      ],
      rows,
    );
  }

  @Get('spend-by-vendor/export')
  @RequirePermissions(P.REPORT_VIEW)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="spend-by-vendor.csv"')
  async spendByVendorCsv(@Query() q: SpendByVendorQueryDto): Promise<string> {
    const rows = await this.reports.spendByVendor(q);
    return toCsv(
      [
        { header: 'vendor', value: (r) => r.vendorName },
        { header: 'count', value: (r) => r.count },
        { header: 'baseTotal', value: (r) => r.baseTotal },
        { header: 'cumulativePct', value: (r) => r.cumulativePct },
      ],
      rows,
    );
  }
}
