import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { AccountingModule } from '../accounting/accounting.module';
import { BudgetTxn } from '../budget/budget.entities';
import { Payment } from '../payment-handoff/payment.entities';
import { AccountRoleService } from './account-role.service';
import { FinancialReportsController } from './financial-reports.controller';
import { FinancialReportsService } from './financial-reports.service';
import { GlPostingListener } from './gl-posting.listener';
import { GlPostingSweeper } from './gl-posting-sweeper.service';
import { GlPostingSweeperScheduler } from './gl-posting-sweeper.scheduler';
import { GlPostingAttempt } from './gl-posting.entities';
import { GlPostingService } from './gl-posting.service';
import { AccountRole, JournalEntry, JournalLine } from './gl.entities';
import { JournalController } from './journal.controller';
import { JournalService } from './journal.service';
import { AccountingPeriodController } from '../accounting/period/accounting-period.controller';
import { AccountingPeriodService } from '../accounting/period/accounting-period.service';

// Double-entry general ledger. Subscribes to `payment.settled` (posting engine) and exposes
// read-only journal + financial-statement reads. Posts against the chart of accounts; no budget_txn.
@Module({
  imports: [
    MikroOrmModule.forFeature([AccountRole, JournalEntry, JournalLine, GlPostingAttempt, BudgetTxn, Payment]),
    // AccountService, to resolve an item's per-company GL for the issue entry.
    AccountingModule,
  ],
  controllers: [JournalController, FinancialReportsController, AccountingPeriodController],
  providers: [
    CompanyScopeService,
    AccountRoleService,
    GlPostingService,
    JournalService,
    FinancialReportsService,
    GlPostingListener,
    GlPostingSweeper,
    GlPostingSweeperScheduler,
    AccountingPeriodService,
  ],
  exports: [GlPostingService, AccountRoleService, GlPostingSweeper],
})
export class GeneralLedgerModule {}
