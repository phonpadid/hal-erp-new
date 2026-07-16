import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { AccountingModule } from '../accounting/accounting.module';
import { RbacModule } from '../rbac/rbac.module';
import { ItemController } from './item.controller';
import { ItemService } from './item.service';
import {
  Item,
  ItemCompany,
  Vendor,
  VendorBankAccount,
  VendorBankAccountLog,
  VendorCompany,
} from './master-data.entities';
import { VendorBankAccountController } from './vendor-bank-account.controller';
import { VendorBankAccountService } from './vendor-bank-account.service';
import { VendorController } from './vendor.controller';
import { VendorService } from './vendor.service';

@Module({
  imports: [
    MikroOrmModule.forFeature([
      Vendor,
      VendorCompany,
      VendorBankAccount,
      VendorBankAccountLog,
      Item,
      ItemCompany,
    ]),
    RbacModule, // ScopeService (first real consumer of the data-scope seam)
    AccountingModule, // AccountService.resolvePostable to validate the per-company item GL
  ],
  controllers: [VendorController, VendorBankAccountController, ItemController],
  providers: [CompanyScopeService, VendorService, VendorBankAccountService, ItemService],
  // Guards/lookups document-engine will consume.
  exports: [VendorService, VendorBankAccountService, ItemService],
})
export class MasterDataModule {}
