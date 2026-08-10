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
import { BudgetService } from './budget.service';
import { BudgetTransferService } from './budget-transfer.service';
import { Budget, BudgetControlPoint, BudgetMovement, BudgetTxn } from './budget.entities';

@Module({
  imports: [
    MikroOrmModule.forFeature([Budget, BudgetTxn, BudgetMovement, BudgetControlPoint]),
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
    BudgetService,
    BudgetBalanceService,
    BudgetControlPointService,
    BudgetCoverageService,
    BudgetLedgerService,
    BudgetAdjustmentService,
    BudgetTransferService,
    DeptDocTypeService,
    NumberingService,
  ],
  // Ledger engine consumed by document-engine (reserve/settle) and
  // approval-workflow (executeTransfer/executeAdjustment).
  exports: [BudgetService, BudgetBalanceService, BudgetControlPointService, BudgetCoverageService, BudgetLedgerService],
})
export class BudgetControlModule {}
