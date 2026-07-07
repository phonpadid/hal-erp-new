import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import { AsOfQueryDto, DateRangeQueryDto } from './dto/financial.dto';
import { FinancialReportsService } from './financial-reports.service';
import { GlPermissions as P } from './permissions';

// Read-only financial statements derived from the GL journal. Company-scoped; GL_VIEW-gated.
@Controller('financial')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FinancialReportsController {
  constructor(private readonly reports: FinancialReportsService) {}

  @Get('trial-balance')
  @RequirePermissions(P.GL_VIEW)
  trialBalance(@Query() q: DateRangeQueryDto) {
    return this.reports.trialBalance(q.from, q.to);
  }

  @Get('income-statement')
  @RequirePermissions(P.GL_VIEW)
  incomeStatement(@Query() q: DateRangeQueryDto) {
    return this.reports.incomeStatement(q.from, q.to);
  }

  @Get('balance-sheet')
  @RequirePermissions(P.GL_VIEW)
  balanceSheet(@Query() q: AsOfQueryDto) {
    return this.reports.balanceSheet(q.asOf);
  }

  @Get('ledger/:accountId')
  @RequirePermissions(P.GL_VIEW)
  accountLedger(@Param('accountId', ParseUUIDPipe) accountId: string, @Query() q: DateRangeQueryDto) {
    return this.reports.accountLedger(accountId, q.from, q.to);
  }
}
