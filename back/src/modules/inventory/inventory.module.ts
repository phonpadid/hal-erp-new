import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { COSTING_STRATEGY, WeightedAverageCosting } from './costing.strategy';
import { InventoryController } from './inventory.controller';
import { StockBalance, StockTxn, Warehouse } from './inventory.entities';
import { StockBalanceService } from './stock-balance.service';
import { StockLedgerService } from './stock-ledger.service';
import { StockMovementService } from './stock-movement.service';
import { WarehouseController } from './warehouse.controller';
import { WarehouseService } from './warehouse.service';

@Module({
  imports: [MikroOrmModule.forFeature([Warehouse, StockTxn, StockBalance])],
  controllers: [WarehouseController, InventoryController],
  providers: [
    CompanyScopeService,
    // The costing seam: bind a different class here to move the whole ledger to FIFO.
    { provide: COSTING_STRATEGY, useClass: WeightedAverageCosting },
    WarehouseService,
    StockLedgerService,
    StockBalanceService,
    StockMovementService,
  ],
  // Consumed by document-engine (submit-time reservation, receipt hook) and
  // approval-workflow (the stock post-actions).
  exports: [WarehouseService, StockLedgerService, StockBalanceService, StockMovementService],
})
export class InventoryModule {}
