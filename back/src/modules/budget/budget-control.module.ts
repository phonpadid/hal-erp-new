import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { MultiCompanyModule } from '../multi-company/multi-company.module';
import { DeptDocTypeService } from '../document/dept-doc-type.service';
import { NumberingService } from '../document/numbering.service';
import { BudgetAdjustmentService } from './budget-adjustment.service';
import { BudgetBalanceService } from './budget-balance.service';
import { BudgetController } from './budget.controller';
import { BudgetControlPointService } from './budget-control-point.service';
import { BudgetCoverageService } from './budget-coverage.service';
import { BudgetLedgerService } from './budget-ledger.service';
import { BudgetPlanService } from './budget-plan.service';
import { BudgetService } from './budget.service';
import { BudgetNodeService } from './budget-node.service';
import { BudgetTransferService } from './budget-transfer.service';
import { Budget, BudgetControlPoint, BudgetMovement, BudgetNode, BudgetTxn } from './budget.entities';

@Module({
  imports: [
    MikroOrmModule.forFeature([Budget, BudgetNode, BudgetTxn, BudgetMovement, BudgetControlPoint]),
    AccountingModule,
    // FiscalYearService for the resolve-budget read (fiscal year covering the document date).
    // multi-company is upstream of budget-control in the build order, so this is not a cycle.
    MultiCompanyModule,
  ],
  controllers: [BudgetController],
  // NumberingService + DeptDocTypeService are EntityManager-only helpers reused from
  // the document module; provided locally (not via DocumentEngineModule) to avoid a
  // circular module dependency — document-engine already imports budget-control.
  providers: [
    BudgetNodeService,
    BudgetService,
    BudgetBalanceService,
    BudgetControlPointService,
    BudgetCoverageService,
    BudgetLedgerService,
    BudgetAdjustmentService,
    BudgetTransferService,
    BudgetPlanService,
    DeptDocTypeService,
    NumberingService,
  ],
  // Ledger engine consumed by document-engine (reserve/settle) and
  // approval-workflow (executeTransfer/executeAdjustment). BudgetPlanService is consumed by
  // approval-workflow (activate on full approval) and document-engine (mark a rejected plan's
  // budgets REJECTED alongside the other hold releases).
  exports: [
    BudgetNodeService,BudgetService, BudgetBalanceService, BudgetControlPointService, BudgetCoverageService, BudgetLedgerService, BudgetPlanService],
})
export class BudgetControlModule {}
