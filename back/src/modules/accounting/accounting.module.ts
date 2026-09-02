import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { Account } from './accounting.entities';
import { AccountingPeriod, AccountingPeriodLog } from './period/accounting-period.entities';
import { PeriodGuardService } from './period/period-guard.service';

// Chart of accounts, and the accounting periods that decide which days are still writable.
// Exports AccountService so budget-control can resolve a GL code to a real account before
// persisting it, and PeriodGuardService so the GL posting engine can ask whether a day is open.
//
// The period CONTROLLER and its service live in the GL module instead: closing a period asks the
// undelivered-postings read, so the close depends on the GL while the guard does not. Keeping the
// guard here and the workflow there is what stops the two modules importing each other.
@Module({
  imports: [MikroOrmModule.forFeature([Account, AccountingPeriod, AccountingPeriodLog])],
  controllers: [AccountController],
  providers: [CompanyScopeService, AccountService, PeriodGuardService],
  exports: [AccountService, PeriodGuardService],
})
export class AccountingModule {}
