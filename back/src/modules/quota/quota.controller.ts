import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import { CreateQuotaDto, UpdateQuotaDto } from './dto/quota.dto';
import { QuotaBalanceService } from './quota-balance.service';
import { QuotaService } from './quota.service';
import { QuotaPermissions as P } from './permissions';
import { DocumentPermissions as DocP } from '../document/permissions';

@Controller('quotas')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class QuotaController {
  constructor(
    private readonly quotas: QuotaService,
    private readonly balance: QuotaBalanceService,
  ) {}

  @Post()
  @RequirePermissions(P.QUOTA_MANAGE)
  create(@Body() dto: CreateQuotaDto) {
    return this.quotas.create(dto);
  }

  @Get()
  @RequirePermissions(P.QUOTA_VIEW)
  list(@Query() q: PaginationQueryDto) {
    return this.quotas.list(q);
  }

  // Quota picker for the Create Document wizard. Authorized by DOC_CREATE (not QUOTA_VIEW) so a
  // requester can pick a quota to reserve against without the finance read; selection fields only.
  // Declared before :id so the literal path isn't captured by the id route.
  @Get('selectable')
  @RequirePermissions(DocP.DOC_CREATE)
  selectable() {
    return this.quotas.selectableForRequester();
  }

  @Get(':id')
  @RequirePermissions(P.QUOTA_VIEW)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.quotas.get(id);
  }

  @Get(':id/remaining')
  @RequirePermissions(P.QUOTA_VIEW)
  async remaining(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('employeeId') employeeId?: string,
    @Query('year', new ParseIntPipe({ optional: true })) year?: number,
  ) {
    return { quotaId: id, remaining: await this.balance.remaining(id, { employeeId, year }) };
  }

  @Get(':id/breakdown')
  @RequirePermissions(P.QUOTA_VIEW)
  async breakdownOf(@Param('id', ParseUUIDPipe) id: string) {
    await this.quotas.get(id); // enforce active-company scope
    return this.balance.breakdown(id);
  }

  @Get(':id/usage')
  @RequirePermissions(P.QUOTA_VIEW)
  async usageOf(@Param('id', ParseUUIDPipe) id: string, @Query() q: PaginationQueryDto) {
    await this.quotas.get(id); // enforce active-company scope
    return this.balance.usageLedger(id, q);
  }

  @Patch(':id')
  @RequirePermissions(P.QUOTA_MANAGE)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateQuotaDto) {
    return this.quotas.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(P.QUOTA_MANAGE)
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.quotas.deactivate(id);
  }
}
