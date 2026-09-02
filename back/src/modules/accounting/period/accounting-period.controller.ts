import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../../auth/permissions.guard';
import { RequirePermissions } from '../../../auth/require-permissions.decorator';
import { AccountingPermissions as P } from '../permissions';
import { AccountingPeriodService } from './accounting-period.service';
import { DeclarePeriodDto, ReopenPeriodDto } from './dto/accounting-period.dto';

@Controller('accounting-periods')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AccountingPeriodController {
  constructor(private readonly periods: AccountingPeriodService) {}

  @Get()
  @RequirePermissions(P.PERIOD_VIEW)
  list() {
    return this.periods.list();
  }

  /**
   * The fiscal years a period may be declared into.
   *
   * Here rather than on the fiscal-year controller: `RequirePermissions` is AND, so no single
   * endpoint can be gated on "FISCAL_YEAR_MANAGE or PERIOD_MANAGE", and a period manager should not
   * need the organisation's code to name a year. Declared above `:id/…` so no parameterised route
   * can shadow it.
   */
  @Get('fiscal-years')
  @RequirePermissions(P.PERIOD_MANAGE)
  selectableFiscalYears() {
    return this.periods.selectableFiscalYears();
  }

  /**
   * What was done to a period, and why.
   *
   * `PERIOD_VIEW`, not a management code: reading the audit trail is the auditor's act, and gating
   * it behind the codes that close or reopen would mean the only people who can read it are the
   * people it exists to hold accountable.
   */
  @Get(':id/log')
  @RequirePermissions(P.PERIOD_VIEW)
  log(@Param('id', ParseUUIDPipe) id: string) {
    return this.periods.log(id);
  }

  @Post()
  @RequirePermissions(P.PERIOD_MANAGE)
  declare(@Body() dto: DeclarePeriodDto) {
    return this.periods.declare(dto);
  }

  /** Refused while an earlier period is open, or while this one still owes a posting. */
  @Post(':id/close')
  @RequirePermissions(P.PERIOD_CLOSE)
  close(@Param('id', ParseUUIDPipe) id: string) {
    return this.periods.close(id);
  }

  /**
   * A separate permission from closing, deliberately: closing a month is routine, and reopening one
   * that has already been reported is not.
   */
  @Post(':id/reopen')
  @RequirePermissions(P.PERIOD_REOPEN)
  reopen(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReopenPeriodDto) {
    return this.periods.reopen(id, dto.reason);
  }
}
