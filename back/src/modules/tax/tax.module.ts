import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { AccountRoleService } from '../gl/account-role.service';
import { PeriodGuardService } from '../accounting/period/period-guard.service';
import { TaxController } from './tax.controller';
import { WhtController } from './wht.controller';
import { WhtService } from './wht.service';
import { WhtCertificate, WhtCertificateNumber } from './wht.entities';
import { TaxService } from './tax.service';
import { TaxCode } from './tax.entities';
import { VatReturn } from './vat-return.entities';

// Purchase tax (VAT slice). Exports TaxService so the document submit flow can compute line VAT.
@Module({
  imports: [MikroOrmModule.forFeature([TaxCode, WhtCertificate, WhtCertificateNumber, VatReturn])],
  controllers: [TaxController, WhtController],
  providers: [CompanyScopeService, TaxService, WhtService, AccountRoleService, PeriodGuardService],
  exports: [TaxService, WhtService],
})
export class TaxModule {}
