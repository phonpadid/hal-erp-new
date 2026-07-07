import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { BudgetTxn } from '../budget/budget.entities';
import { Payment } from '../payment-handoff/payment.entities';
import { AccountRoleService } from './account-role.service';
import { FinancialReportsController } from './financial-reports.controller';
import { FinancialReportsService } from './financial-reports.service';
import { GlPostingListener } from './gl-posting.listener';
import { GlPostingService } from './gl-posting.service';
import { AccountRole, JournalEntry, JournalLine } from './gl.entities';
import { JournalController } from './journal.controller';
import { JournalService } from './journal.service';

// Double-entry general ledger. Subscribes to `payment.settled` (posting engine) and exposes
// read-only journal + financial-statement reads. Posts against the chart of accounts; no budget_txn.
@Module({
  imports: [MikroOrmModule.forFeature([AccountRole, JournalEntry, JournalLine, BudgetTxn, Payment])],
  controllers: [JournalController, FinancialReportsController],
  providers: [
    CompanyScopeService,
    AccountRoleService,
    GlPostingService,
    JournalService,
    FinancialReportsService,
    GlPostingListener,
  ],
  exports: [GlPostingService, AccountRoleService],
})
export class GeneralLedgerModule {}
