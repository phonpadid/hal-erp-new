import { Entity, Enum, Index, ManyToOne, Property, Unique } from '@mikro-orm/core';
import { StockTxnType } from '../../common/enums';
import { BaseEntity, CompanyScopedEntity } from '../../common/entities/base.entity';
import { Document, DocumentLine } from '../document/document.entities';
import { Item } from '../master-data/master-data.entities';
import { Company } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';

// warehouse — a stock location owned by one company. Stock never crosses a company boundary
// (invariant 1), so there is no inter-company transfer — only intra-company.
@Entity({ tableName: 'warehouse' })
@Unique({ properties: ['company', 'code'] })
export class Warehouse extends CompanyScopedEntity {
  @ManyToOne(() => Company)
  company!: Company;

  @Property()
  code!: string;

  @Property()
  name!: string;

  // Deactivated, never deleted: historical stock_txn rows point here and must stay readable.
  @Property({ default: true })
  isActive: boolean = true;
}

/**
 * stock_txn — APPEND-ONLY ledger (invariant 2), the same shape as budget_txn. Inserts only;
 * corrections are new rows. `qty` is always positive — direction comes from `txnType`, never
 * from a sign, so a SUM by type is unambiguous and a stray negative cannot quietly invert a
 * movement.
 */
@Entity({ tableName: 'stock_txn' })
@Index({ properties: ['company', 'item', 'warehouse'] })
export class StockTxn extends CompanyScopedEntity {
  @ManyToOne(() => Company)
  company!: Company;

  @ManyToOne(() => Item)
  item!: Item;

  @ManyToOne(() => Warehouse)
  warehouse!: Warehouse;

  @Enum({ items: () => StockTxnType })
  txnType!: StockTxnType;

  @Property({ type: 'decimal', precision: 15, scale: 4 })
  qty!: string;

  // The cost this row moved at, in the company base currency. RESERVE and RELEASE carry none:
  // they change only what is available, so no value has moved.
  @Property({ type: 'decimal', precision: 15, scale: 6, nullable: true })
  unitCost?: string;

  @Index()
  @ManyToOne(() => Document, { fieldName: 'document_id', nullable: true })
  document?: Document;

  // The PO line a receipt came from — the trail back to 3-way matching.
  @ManyToOne(() => DocumentLine, { fieldName: 'document_line_id', nullable: true })
  documentLine?: DocumentLine;

  @Property({ nullable: true })
  remark?: string;

  @ManyToOne(() => AppUser, { fieldName: 'created_by', nullable: true })
  createdBy?: AppUser;

  @Property({ columnType: 'timestamptz', nullable: true })
  createdAt?: Date;
}

/**
 * stock_balance — a projection of stock_txn, not an independently authored number: replaying the
 * ledger must reproduce it exactly (invariant 3). It exists for two reasons only — it is the row
 * we take PESSIMISTIC_WRITE on before checking availability or re-averaging cost, and it saves an
 * aggregate scan on every read.
 *
 * Written only inside the same transaction as the stock_txn rows it reflects, never by a
 * background job.
 */
@Entity({ tableName: 'stock_balance' })
@Unique({ properties: ['company', 'item', 'warehouse'] })
export class StockBalance extends CompanyScopedEntity {
  @ManyToOne(() => Company)
  company!: Company;

  @ManyToOne(() => Item)
  item!: Item;

  @ManyToOne(() => Warehouse)
  warehouse!: Warehouse;

  @Property({ type: 'decimal', precision: 15, scale: 4, default: 0 })
  qtyOnHand: string = '0';

  // Held by submitted-but-unfinished documents. Available = qtyOnHand - qtyReserved.
  @Property({ type: 'decimal', precision: 15, scale: 4, default: 0 })
  qtyReserved: string = '0';

  // Moving weighted average. Six decimals because it is a RATE, not a posted amount: rounding it
  // to 2 lets error accumulate across many small receipts. Amounts derived from it are rounded to
  // the currency's decimal_places at posting time.
  @Property({ type: 'decimal', precision: 15, scale: 6, default: 0 })
  avgCost: string = '0';

  @Property({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  totalValue: string = '0';

  @Property({ columnType: 'timestamptz', nullable: true, onUpdate: () => new Date() })
  updatedAt?: Date;
}
