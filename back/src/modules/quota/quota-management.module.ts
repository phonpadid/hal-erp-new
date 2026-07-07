import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { QuotaBalanceService } from './quota-balance.service';
import { QuotaEntitlementController } from './quota-entitlement.controller';
import { QuotaEntitlementService } from './quota-entitlement.service';
import { Quota, QuotaEntitlement, QuotaUsage } from './quota.entities';
import { QuotaController } from './quota.controller';
import { QuotaService } from './quota.service';
import { QuotaUsageService } from './quota-usage.service';

@Module({
  imports: [MikroOrmModule.forFeature([Quota, QuotaUsage, QuotaEntitlement])],
  controllers: [QuotaController, QuotaEntitlementController],
  providers: [
    CompanyScopeService,
    QuotaService,
    QuotaBalanceService,
    QuotaEntitlementService,
    QuotaUsageService,
  ],
  // Engine consumed by document-engine (reserve/releaseAll) for HR flows.
  exports: [QuotaBalanceService, QuotaUsageService, QuotaService],
})
export class QuotaManagementModule {}
