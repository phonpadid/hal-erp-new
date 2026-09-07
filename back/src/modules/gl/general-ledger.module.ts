import { MikroOrmModule } from '@mikro-orm/nestjs';
import { forwardRef, Module } from '@nestjs/common';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { AccountingModule } from '../accounting/accounting.module';
import { DocumentEngineModule } from '../document/document-engine.module';
import { BudgetTxn } from '../budget/budget.entities';
import { Payment } from '../payment-handoff/payment.entities';
import { AccountRoleController } from './account-role.controller';
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
import { JournalVoucherService } from './journal-voucher.service';
import { PeriodGuardService } from '../accounting/period/period-guard.service';
import { ExchangeRateService } from '../currency/exchange-rate.service';
import { FxRevaluationService } from './fx-revaluation.service';
import { ReceivedNotInvoicedService } from './received-not-invoiced.service';
import { YearCloseService } from './year-close.service';
import { AccountingPeriodController } from '../accounting/period/accounting-period.controller';
import { AccountingPeriodService } from '../accounting/period/accounting-period.service';

// Double-entry general ledger. Subscribes to `payment.settled` (posting engine) and exposes
// read-only journal + financial-statement reads. Posts against the chart of accounts; no budget_txn.
@Module({
  imports: [
    MikroOrmModule.forFeature([AccountRole, JournalEntry, JournalLine, GlPostingAttempt, BudgetTxn, Payment]),
    // AccountService, to resolve an item's per-company GL for the issue entry.
    AccountingModule,
    // DocumentService + DocumentSubmitService, because a journal voucher is a document: it is
    // numbered, routed and submitted by the same code every other document uses. The document
    // engine imports this module back for settlement posting — see the note there on why the cycle
    // is the honest shape rather than an accident.
    forwardRef(() => DocumentEngineModule),
  ],
  controllers: [
    JournalController,
    FinancialReportsController,
    AccountingPeriodController,
    AccountRoleController,
  ],
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
    JournalVoucherService,
    PeriodGuardService,
    ReceivedNotInvoicedService,
    FxRevaluationService,
    ExchangeRateService,
    YearCloseService,
  ],
  exports: [GlPostingService, AccountRoleService, GlPostingSweeper],
})
export class GeneralLedgerModule {}
