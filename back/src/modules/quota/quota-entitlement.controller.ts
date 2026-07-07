import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import {
  AdjustEntitlementDto,
  CarryForwardDto,
  EntitlementQueryDto,
  UpsertEntitlementDto,
} from './dto/entitlement.dto';
import { QuotaEntitlementService } from './quota-entitlement.service';
import { QuotaPermissions as P } from './permissions';

@Controller('quota-entitlements')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class QuotaEntitlementController {
  constructor(private readonly entitlements: QuotaEntitlementService) {}

  @Get()
  @RequirePermissions(P.QUOTA_VIEW)
  list(@Query() q: EntitlementQueryDto) {
    return this.entitlements.listForQuota(q.quotaId, q.year);
  }

  @Post()
  @RequirePermissions(P.QUOTA_MANAGE)
  upsert(@Body() dto: UpsertEntitlementDto) {
    return this.entitlements.upsert(dto);
  }

  @Post('adjust')
  @RequirePermissions(P.QUOTA_MANAGE)
  adjust(@Body() dto: AdjustEntitlementDto) {
    return this.entitlements.adjust(dto);
  }

  @Post('carry-forward')
  @RequirePermissions(P.QUOTA_MANAGE)
  carryForward(@Body() dto: CarryForwardDto) {
    return this.entitlements.carryForward(dto);
  }
}
