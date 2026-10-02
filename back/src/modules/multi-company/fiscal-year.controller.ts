import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequireAnyPermission, RequirePermissions } from '../../auth/require-permissions.decorator';
import { RequestContext } from '../../common/context/request-context';
import { BudgetPermissions } from '../budget/permissions';
import { QuotaPermissions } from '../quota/permissions';
import { FiscalYearReadinessService } from './fiscal-year-readiness.service';
import { CreateFiscalYearDto, UpdateFiscalYearDto } from './dto/fiscal-year.dto';
import { FiscalYearService } from './fiscal-year.service';
import { MultiCompanyPermissions as P } from './permissions';

@Controller('fiscal-years')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FiscalYearController {
  constructor(
    private readonly fiscalYears: FiscalYearService,
    private readonly readiness: FiscalYearReadinessService,
  ) {}

  /**
   * What the next fiscal year still lacks. Declared before `:id`, which would otherwise take
   * "readiness" for an id. Any one of three jobs prepares a year, and none of their codes means
   * the other two, so any one of them may read it.
   */
  @Get('readiness')
  @RequireAnyPermission(P.FISCAL_YEAR_MANAGE, BudgetPermissions.BUDGET_MANAGE, QuotaPermissions.QUOTA_MANAGE)
  readinessForActiveCompany() {
    return this.readiness.read(RequestContext.companyId()!);
  }

  @Post()
  @RequirePermissions(P.FISCAL_YEAR_MANAGE)
  create(@Body() dto: CreateFiscalYearDto) {
    return this.fiscalYears.create(dto);
  }

  @Get()
  @RequirePermissions(P.FISCAL_YEAR_MANAGE)
  list(@Query() q: PaginationQueryDto) {
    return this.fiscalYears.list(q);
  }

  @Get(':id')
  @RequirePermissions(P.FISCAL_YEAR_MANAGE)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.fiscalYears.get(id);
  }

  @Patch(':id')
  @RequirePermissions(P.FISCAL_YEAR_MANAGE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFiscalYearDto,
  ) {
    return this.fiscalYears.update(id, dto);
  }

  @Post(':id/close')
  @RequirePermissions(P.FISCAL_YEAR_MANAGE)
  close(@Param('id', ParseUUIDPipe) id: string) {
    return this.fiscalYears.close(id);
  }
}
