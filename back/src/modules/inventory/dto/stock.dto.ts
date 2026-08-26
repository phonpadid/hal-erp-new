import { IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto, SearchablePaginationQueryDto } from '../../../common/pagination/pagination';

/** Filters for the on-hand read: everything the active company holds, narrowed. */
export class StockOnHandQueryDto extends SearchablePaginationQueryDto {
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsOptional()
  @IsUUID()
  itemId?: string;
}

/** Filters for the movement-history read. Item is required — history is read per item. */
export class StockLedgerQueryDto extends PaginationQueryDto {
  @IsUUID()
  itemId!: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}

/** Target of a balance recompute: one (item, warehouse) pair rebuilt from its ledger. */
export class RecomputeBalanceDto {
  @IsUUID()
  itemId!: string;

  @IsUUID()
  warehouseId!: string;
}
