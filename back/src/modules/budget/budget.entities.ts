import { Entity, Enum, Index, ManyToOne, OptionalProps, Property, Unique } from '@mikro-orm/core';
import { Account } from '../accounting/accounting.entities';
import { BudgetTxnType } from '../../common/enums';
import { BaseEntity, CompanyScopedEntity } from '../../common/entities/base.entity';
import { Document } from '../document/document.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { FiscalYear } from '../multi-company/multi-company.entities';

/**
 * budget_node — the STRUCTURE of a budget plan: department → category → line.
 *
 * A node is not a budget, and that distinction is the whole reason this table exists. A category
 * has no amount, is charged by nothing, and is approved by nobody on its own. Modelling categories
 * as budgets holding no amount was tried first and put rows in the `budget` table that were not
 * budgets — leaving five separate readers of that table having to remember which was which, and
 * three of them getting it wrong. What is not a budget is not in the budget table.
 *
 * This is also the tree a `budget_control_point` walks. It used to walk the ACCOUNT tree, which
 * only worked while a budget was identified by its account.
 *
 * A node carries NO department, deliberately. A control point names a node AND a department node,
 * and the two have to select independently; a node that fixed the department would leave the
 * department half able only to pass or fail as a whole, never to tell two budgets apart, and half
 * of coverage would be dead. Organisations whose codes encode a department — as this one's do —
 * already say so in their numbering.
 *
 * Scoped per fiscal year, like a budget. Nothing in the customer's plan asks for a structure that
 * outlives a year — 10 of 254 lines carry a prior-year figure and there is no second year to
 * compare against — so a cross-year chart of budget structure is not built.
 */
@Entity({ tableName: 'budget_node' })
@Unique({ properties: ['fiscalYear', 'code'] })
@Index({ properties: ['parent'] })
export class BudgetNode extends BaseEntity {
  // `isShared` defaults to false, so a node may be created without stating it — which is what
  // every existing caller does, and what an unmarked node means.
  [OptionalProps]?: 'isShared';

  @ManyToOne(() => FiscalYear)
  fiscalYear!: FiscalYear;

  /**
   * The organisation's own name for this place in the plan — `1`, `1.1`, `1.101`.
   *
   * It does NOT encode depth. Their own codes prove why: `1.1` is a category and `1.101` a line
   * beneath it, and both carry exactly one dot. `parent` is the hierarchy; this is a label people
   * say out loud and write on requests.
   */
  @Property()
  code!: string;

  @Property({ nullable: true })
  name?: string;

  /** Parent in the plan. Must sit in the same fiscal year and department; a cycle is refused. */
  @ManyToOne(() => BudgetNode, { fieldName: 'parent_id', nullable: true })
  parent?: BudgetNode;

  /**
   * This place in the plan carries money the WHOLE COMPANY draws on, so any department may charge
   * a budget at or beneath it.
   *
   * On the NODE and inherited by the subtree, because that is the shape the money actually has.
   * `1.100 ຄ່າບໍລິຫານ ທົວໄປ` holds the office supplies, the drinking water and the cleaning
   * materials; `1.400 ລາຍຈ່າຍປະຈຳເດືອນ` holds the security guards at head office and the sorting
   * centre, the Synergy licence, the monthly phone bills and the cleaning contract. Marketing pays
   * for its phones out of that, and the plan groups it that way already — two marks cover the lot,
   * where a flag per budget would mean ticking those lines one at a time and re-ticking every line
   * added after.
   *
   * It says who may CHARGE the money, never who OWNS it: `budget.department_id` is untouched, so a
   * shared budget keeps its owner for control-point coverage and for every report that asks whose
   * appropriation it is.
   *
   * Default false. The plan workbook has no column that states this — the knowledge lived only in
   * people's heads — so no import can infer it and nothing is backfilled. Somebody says so, or it
   * is not so.
   */
  @Property({ default: false })
  isShared: boolean = false;
}

// budget — balance is DERIVED from budget_txn; never overwrite amount_total to reflect usage.
@Entity({ tableName: 'budget' })
// The dimension key is PARTIAL, not a plain @Unique({ properties }). A DRAFT budget holding its
// slot is wanted — it is what stops two budget plans proposing the same line concurrently, decided
// by the database rather than by a check-then-insert race here. A REJECTED one holding it forever
// is not: that line could never be budgeted again for the year. Declared here rather than only in a
// migration because specs build their schema from these entities, and an index that lives only in a
// migration is one no test can exercise.
//
// The slot is now (node, department): a node carries the fiscal year but not a department, so one
// node can legitimately hold two departments' money and the department stays part of the slot.
@Index({
  name: 'budget_dimension_unique_unless_rejected',
  expression:
    'create unique index "budget_dimension_unique_unless_rejected" on "budget" ' +
    '("node_id", "department_id") where "status" <> \'REJECTED\'',
})
export class Budget extends BaseEntity {
  @ManyToOne(() => FiscalYear)
  fiscalYear!: FiscalYear;

  @ManyToOne(() => Department)
  department!: Department;

  /**
   * Where in the plan this money sits — and the budget's identity, together with the fiscal year
   * and department the node already carries.
   *
   * The GL account used to be that identity and cannot be: one account is charged by several
   * budgets and one budget posts to several accounts, in the same department and year, so a key
   * containing the account can express neither.
   */
  @ManyToOne(() => BudgetNode, { fieldName: 'node_id' })
  node!: BudgetNode;

  /**
   * Nullable, and no longer part of any key or lookup.
   *
   * Read for one thing only: stamping the GL of a line that carries no item on a type that sets no
   * `default_gl_account`. A budget whose spending genuinely posts to several accounts leaves it
   * null — `1.3 vehicle instalments` covers loan principal and interest, and neither is "the"
   * account, so recording one would be a lie this column used to require.
   */
  @Property({ nullable: true })
  glAccount?: string;

  // Resolved from glAccount at write time when one is given. Nullable: a budget may name no
  // account at all.
  @ManyToOne(() => Account, { fieldName: 'account_id', nullable: true })
  account?: Account;

  @Property({ nullable: true })
  budgetName?: string;

  /**
   * The money. NOT NULL: every row in this table is an appropriation.
   *
   * An earlier design made categories budget rows holding no amount, and then had to forbid a
   * parent from holding one — a control point summing over a node AND its descendants would have
   * counted a subtree's money twice and doubled its ceiling with nothing raised. Categories are
   * `budget_node` rows now, so there is no shape to forbid.
   */
  @Property({ type: 'decimal', precision: 15, scale: 2 })
  amountTotal!: string;

  /**
   * DRAFT → ACTIVE → CLOSED, or DRAFT → REJECTED.
   *
   * DRAFT is a budget a plan has proposed and nobody has approved yet: not spendable, and owed no
   * control-point coverage. ACTIVE is in force, and is the only status the coverage invariant
   * applies to. REJECTED is a proposal that was turned down — kept rather than deleted, because
   * `budget_movement.to_budget_id` references it and the record of what was refused is the point
   * of routing budgets through approval at all.
   *
   * CLOSED is an appropriation that ran its year: set when the fiscal year closes, it keeps
   * `amount_total` and every ledger row exactly as they are and stops being a pot anything can draw
   * on. Distinct from REJECTED — one ran its year, the other was turned down — and still readable
   * by every report that asks what was voted and what was spent. A CLOSED budget is not ACTIVE, so
   * it also falls out of the control-point coverage invariant, correctly: a ceiling on a pot nobody
   * can draw from governs nothing.
   *
   * The default stays ACTIVE for rows written outside a plan: seed data, and every row that
   * predates plans. `BudgetService.create` sets DRAFT explicitly.
   */
  @Property({ default: 'ACTIVE' })
  status: string = 'ACTIVE';
}

/**
 * budget_control_point — WHERE availability is checked, as opposed to WHERE it is posted.
 *
 * A budget is governed by every active control point in the same company and fiscal year whose
 * `budgetNode` is that budget's own node or an ancestor of it (via `budget_node.parent_id`), AND whose
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
@Unique({ properties: ['company', 'fiscalYear', 'budgetNode', 'departmentNode'] })
@Index({ properties: ['company', 'fiscalYear'] })
export class BudgetControlPoint extends CompanyScopedEntity {
  @ManyToOne(() => Company)
  company!: Company;

  @ManyToOne(() => FiscalYear)
  fiscalYear!: FiscalYear;

  /**
   * The node in the BUDGET tree this point checks at — any node at all, leaf or parent.
   *
   * A control point is a checkpoint, never a posting target, so it carries no postability
   * requirement of its own. It used to name an account node; a budget is no longer identified by an
   * account, so the account tree has nothing left to say about which budgets a point governs.
   */
  @ManyToOne(() => BudgetNode, { fieldName: 'budget_node_id' })
  budgetNode!: BudgetNode;

  @ManyToOne(() => Department, { fieldName: 'department_node_id' })
  departmentNode!: Department;

  // NULL = the ceiling is the rollup of the governed budgets' amount_total. No caveat about double
  // counting is needed: a category is a node and holds no amount to count. A non-null ceiling
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

  /**
   * The calendar day of the EVENT this row records, in the company's own timezone — the same rule
   * `journal_entry.entry_date` follows, so the two ledgers share a calendar.
   *
   * Not the insert time: `created_at` is that, and the two differ whenever a backdated movement is
   * approved, whenever a settlement is recorded the next morning, and across every timezone
   * boundary. Conflating them is what left a budget figure impossible to state as of a date.
   */
  @Property({ columnType: 'date' })
  txnDate!: string;

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
