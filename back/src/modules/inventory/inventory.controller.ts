import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import { RecomputeBalanceDto, StockLedgerQueryDto, StockOnHandQueryDto } from './dto/stock.dto';
import { InventoryPermissions as P } from './permissions';
import { StockBalanceService } from './stock-balance.service';
import { StockLedgerService } from './stock-ledger.service';

/**
 * Read surfaces for stock, plus the balance repair path.
 *
 * There is deliberately no endpoint that creates, updates, or deletes a `stock_txn` row: ledger
 * rows are produced only by the receipt hook and the post-action dispatcher, so every movement
 * carries the document that authorised it.
 */
@Controller('inventory')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class InventoryController {
  constructor(
    private readonly balances: StockBalanceService,
    private readonly ledger: StockLedgerService,
  ) {}

  @Get('on-hand')
  @RequirePermissions(P.INV_VIEW)
  onHand(@Query() q: StockOnHandQueryDto) {
    return this.balances.onHand(q);
  }

  @Get('ledger')
  @RequirePermissions(P.INV_VIEW)
  ledgerHistory(@Query() q: StockLedgerQueryDto) {
    return this.ledger.history(q);
  }

  // Rebuilds quantities from the ledger. INV_MANAGE because it rewrites a number the rest of the
  // system trusts — it is the repair path, not a routine read.
  @Post('recompute')
  @HttpCode(200)
  @RequirePermissions(P.INV_MANAGE)
  recompute(@Body() dto: RecomputeBalanceDto) {
    return this.balances.recompute(dto.itemId, dto.warehouseId);
  }
}
