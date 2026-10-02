import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ApprovalWorkflowModule } from '../approval/approval-workflow.module';
import { MultiCompanyModule } from '../multi-company/multi-company.module';
import { FiscalYearReadinessScheduler } from './fiscal-year-readiness.scheduler';
import { Notification, NotificationTemplate } from './notification.entities';
import { NotificationController } from './notification.controller';
import { NotificationEventsListener } from './notification-events.listener';
import { NotificationScheduler } from './notification.scheduler';
import { NotificationService } from './notification.service';
import { TemplateService } from './template.service';
import {
  EmailTransport,
  InAppTransport,
  NOTIFICATION_TRANSPORTS,
  NoopTransport,
  type NotificationTransport,
} from './transports/transport';

@Module({
  imports: [
    MikroOrmModule.forFeature([NotificationTemplate, Notification]),
    ApprovalWorkflowModule, // SlaService + ApproverResolverService for the SLA sweep
    MultiCompanyModule, // FiscalYearReadinessService for the year-end sweep
  ],
  controllers: [NotificationController],
  providers: [
    CompanyScopeService,
    TemplateService,
    EmailTransport,
    {
      provide: NOTIFICATION_TRANSPORTS,
      useFactory: (email: EmailTransport): NotificationTransport[] => [
        new InAppTransport(),
        email,
        new NoopTransport('LINE'),
        new NoopTransport('SMS'),
      ],
      inject: [EmailTransport],
    },
    NotificationService,
    NotificationEventsListener,
    NotificationScheduler,
    FiscalYearReadinessScheduler,
  ],
  exports: [NotificationService],
})
export class NotificationsModule {}
