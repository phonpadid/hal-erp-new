import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { Account } from './accounting.entities';

// Chart of accounts (first accounting slice). Exports AccountService so budget-control
// can resolve a GL code to a real account before persisting it.
@Module({
  imports: [MikroOrmModule.forFeature([Account])],
  controllers: [AccountController],
  providers: [CompanyScopeService, AccountService],
  exports: [AccountService],
})
export class AccountingModule {}
