import { MikroOrmModule } from '@mikro-orm/nestjs';
import { forwardRef, Module } from '@nestjs/common';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { PeriodGuardService } from '../accounting/period/period-guard.service';
import { BudgetControlModule } from '../budget/budget-control.module';
import { DocumentEngineModule } from '../document/document-engine.module';
import { InventoryModule } from '../inventory/inventory.module';
import { MultiCompanyModule } from '../multi-company/multi-company.module';
import { RbacModule } from '../rbac/rbac.module';
import { ApprovalConfigController } from './approval-config.controller';
import { ApprovalController } from './approval.controller';
import { ApprovalInboxController } from './approval-inbox.controller';
import {
  ApprovalDelegation,
  ApprovalLog,
  PendingSuccessor,
  Workflow,
  WorkflowStep,
} from './approval.entities';
import { ApprovalInboxService } from './approval-inbox.service';
import { PendingSummaryService } from './pending-summary.service';
import { ApprovalRoutingService } from './approval-routing.service';
import { ApprovalSubmittedListener } from './approval-submitted.listener';
import { ApproverResolverService } from './approver-resolver.service';
import { PostActionService } from './post-action.service';
import { SuccessorSweeper } from './successor-sweeper.service';
import { SuccessorSweeperScheduler } from './successor-sweeper.scheduler';
import { SlaService } from './sla.service';
import { WorkflowConfigService } from './workflow-config.service';
import { DocumentRouteService } from './document-route.service';
import { WorkflowStepResolver } from './workflow-step.resolver';

@Module({
  imports: [
    MikroOrmModule.forFeature([Workflow, WorkflowStep, ApprovalDelegation, ApprovalLog, PendingSuccessor]),
    BudgetControlModule,
    MultiCompanyModule,
    // forwardRef both ways: document-engine imports this module back, so submit can ask whether a
    // document is routable before it takes any hold (document-engine D3a).
    forwardRef(() => DocumentEngineModule),
    RbacModule,
    // The ISSUE_STOCK post-action.
    InventoryModule,
  ],
  controllers: [ApprovalConfigController, ApprovalController, ApprovalInboxController],
  providers: [
    CompanyScopeService,
    WorkflowConfigService,
    ApproverResolverService,
    WorkflowStepResolver,
    DocumentRouteService,
    // The POST_JOURNAL post-action refuses to write the ledger without it.
    PeriodGuardService,
    PostActionService,
    ApprovalRoutingService,
    ApprovalInboxService,
    PendingSummaryService,
    ApprovalSubmittedListener,
    SlaService,
    SuccessorSweeper,
    SuccessorSweeperScheduler,
  ],
  exports: [ApprovalRoutingService, SlaService, ApproverResolverService, WorkflowStepResolver, DocumentRouteService, SuccessorSweeper],
})
export class ApprovalWorkflowModule {}
