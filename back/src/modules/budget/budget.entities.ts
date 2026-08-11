import { Entity, Enum, Index, ManyToOne, Property, Unique } from '@mikro-orm/core';
import { Account } from '../accounting/accounting.entities';
import { BudgetTxnType } from '../../common/enums';
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

  @Property({ default: 'ACTIVE' })
  status: string = 'ACTIVE';
}

/**
 * budget_control_point — WHERE availability is checked, as opposed to WHERE it is posted.
 *
 * A budget is governed by every active control point in the same company and fiscal year whose
 * `accountNode` is that budget's account or an ancestor of it (via `account.parent_id`), AND whose
 * `departmentNode` is that budget's department or an ancestor of it (via `department.parent_dept_id`).
 * Every governing point must pass — checking only the nearest would make adding a narrower point a
 * way to escape a wider ceiling.
 *
 * This is CONFIGURATION, not a ledger: it is deliberately absent from APPEND_ONLY in
 * LedgerGuardSubscriber, and rows may be updated. Money still only ever moves through budget_txn.
 * It is also the row taken FOR UPDATE before an availability check — the same double duty
 * stock_balance carries.
 */
@Entity({ tableName: 'budget_control_point' })
@Unique({ properties: ['company', 'fiscalYear', 'accountNode', 'departmentNode'] })
@Index({ properties: ['company', 'fiscalYear'] })
export class BudgetControlPoint extends CompanyScopedEntity {
  @ManyToOne(() => Company)
  company!: Company;

  @ManyToOne(() => FiscalYear)
  fiscalYear!: FiscalYear;

  // No is_postable requirement: a control point is a checkpoint, never a posting target.
  @ManyToOne(() => Account, { fieldName: 'account_node_id' })
  accountNode!: Account;

  @ManyToOne(() => Department, { fieldName: 'department_node_id' })
  departmentNode!: Department;

  // NULL = the ceiling is the rollup of the governed budgets' amount_total. A non-null ceiling
  // (a node cap deliberately smaller than the sum of its lines) needs a parent/child
  // reconciliation rule and is rejected until that rule exists.
  @Property({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  capAmount?: string;

  // Ordered tolerance ladder, stored as JSON text: [{"at":80,"action":"WARN"}, ...].
  // Parsed and validated on write; never interpreted permissively at check time.
  @Property({ type: 'text' })
  toleranceJson!: string;

  @Property({ default: true })
  isActive: boolean = true;
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
