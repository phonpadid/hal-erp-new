import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { RequestContextMiddleware } from './common/context/request-context.middleware';
import { LedgerGuardSubscriber } from './common/ledger/ledger-guard.subscriber';
import ormConfig from './mikro-orm.config';
import { AccountingModule } from './modules/accounting/accounting.module';
import { ApprovalWorkflowModule } from './modules/approval/approval-workflow.module';
import { BudgetControlModule } from './modules/budget/budget-control.module';
import { MultiCurrencyModule } from './modules/currency/multi-currency.module';
import { DocumentEngineModule } from './modules/document/document-engine.module';
import { ExternalApiModule } from './modules/external-api/external-api.module';
import { GeneralLedgerModule } from './modules/gl/general-ledger.module';
import { TaxModule } from './modules/tax/tax.module';
import { JobLevelModule } from './modules/job-level/job-level.module';
import { MasterDataModule } from './modules/master-data/master-data.module';
import { MultiCompanyModule } from './modules/multi-company/multi-company.module';
import { NotificationsModule } from './modules/notification/notifications.module';
import { PaymentHandoffModule } from './modules/payment-handoff/payment-handoff.module';
import { QuotaManagementModule } from './modules/quota/quota-management.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { ReportingModule } from './modules/reporting/reporting.module';
import { UserPreferencesModule } from './modules/user-preferences/user-preferences.module';
import type { MiddlewareConsumer, NestModule } from '@nestjs/common';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    // forRootAsync so env (loaded by ConfigModule) is read at init, not import
    // time. Re-read the connection vars here: `ormConfig` (the default export) is
    // evaluated at import, before ConfigModule populates process.env from .env, so
    // its host/user/password/dbName would otherwise be stale fallbacks.
    MikroOrmModule.forRootAsync({
      useFactory: () => ({
        ...ormConfig,
        host: process.env.DB_HOST ?? 'localhost',
        port: Number(process.env.DB_PORT ?? 5432),
        user: process.env.DB_USER ?? 'erp',
        password: process.env.DB_PASSWORD ?? 'erp',
        dbName: process.env.DB_NAME ?? 'erp',
        subscribers: [new LedgerGuardSubscriber()],
      }),
    }),
    AuthModule,
    RbacModule,
    MultiCompanyModule,
    MultiCurrencyModule,
    MasterDataModule,
    AccountingModule,
    BudgetControlModule,
    GeneralLedgerModule,
    TaxModule,
    JobLevelModule,
    QuotaManagementModule,
    DocumentEngineModule,
    ExternalApiModule,
    ApprovalWorkflowModule,
    NotificationsModule,
    PaymentHandoffModule,
    UserPreferencesModule,
    ReportingModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Populate the per-request company/permission context for every route.
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
