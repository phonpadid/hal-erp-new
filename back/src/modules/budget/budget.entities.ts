import { Entity, Enum, Index, ManyToOne, Property, Unique } from '@mikro-orm/core';
import { Account } from '../accounting/accounting.entities';
import { BudgetTxnType, ControlPolicy } from '../../common/enums';
import { BaseEntity, CompanyScopedEntity } from '../../common/entities/base.entity';
import { Document } from '../document/document.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { FiscalYear } from '../multi-company/multi-company.entities';

// budget — balance is DERIVED from budget_txn; never overwrite amount_total to reflect usage.
@Entity({ tableName: 'budget' })
@Unique({ properties: ['fiscalYear', 'department', 'glAccount'] })
export class Budget extends BaseEntity {
  @ManyToOne(() => FiscalYear)
  fiscalYear!: FiscalYear;

  @ManyToOne(() => Department)
  department!: Department;

  @Property()
  glAccount!: string;

  // Resolved from glAccount at write time (invariant: active + postable account in this
  // company). Nullable during backfill of pre-existing rows.
  @ManyToOne(() => Account, { fieldName: 'account_id', nullable: true })
  account?: Account;

  @Property({ nullable: true })
  budgetName?: string;

  @Property({ type: 'decimal', precision: 15, scale: 2 })
  amountTotal!: string;

  @Enum({ items: () => ControlPolicy, default: ControlPolicy.HARD_STOP })
  controlPolicy: ControlPolicy = ControlPolicy.HARD_STOP;

  @Property({ default: 'ACTIVE' })
  status: string = 'ACTIVE';
}

// budget_txn — APPEND-ONLY ledger (invariant 2). Inserts only; corrections are new rows.
@Entity({ tableName: 'budget_txn' })
export class BudgetTxn extends BaseEntity {
  @Index()
  @ManyToOne(() => Budget)
  budget!: Budget;

  @Index()
  @ManyToOne(() => Document)
  document!: Document;

  @Enum({ items: () => BudgetTxnType })
  txnType!: BudgetTxnType;

  @Property({ type: 'decimal', precision: 15, scale: 2 })
  amount!: string;

  @Property({ nullable: true })
  remark?: string;

  @ManyToOne(() => AppUser, { fieldName: 'created_by', nullable: true })
  createdBy?: AppUser;

  @Property({ columnType: 'timestamptz', nullable: true })
  createdAt?: Date;
}

// budget_movement — transfer/adjust request; on full approval it writes a paired
// TRANSFER_OUT + TRANSFER_IN into budget_txn inside one DB transaction.
@Entity({ tableName: 'budget_movement' })
export class BudgetMovement extends CompanyScopedEntity {
  @ManyToOne(() => Company)
  company!: Company;

  @Index()
  @ManyToOne(() => Document)
  document!: Document;

  // TRANSFER / ADJUST_INCREASE / ADJUST_DECREASE
  @Property()
  movementType!: string;

  @Index()
  @ManyToOne(() => Budget, { fieldName: 'from_budget_id', nullable: true })
  fromBudget?: Budget;

  @Index()
  @ManyToOne(() => Budget, { fieldName: 'to_budget_id', nullable: true })
  toBudget?: Budget;

  @Property({ type: 'decimal', precision: 15, scale: 2 })
  amount!: string;

  @Property({ nullable: true })
  reason?: string;

  @Property({ columnType: 'date', nullable: true })
  effectiveDate?: string;

  @Property({ columnType: 'timestamptz', nullable: true })
  createdAt?: Date;
}
