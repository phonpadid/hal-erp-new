import { Entity, Index, ManyToOne, Property, Unique } from '@mikro-orm/core';
import { BaseEntity, CompanyScopedEntity } from '../../common/entities/base.entity';
import { Currency } from '../currency/currency.entities';
import { Company } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';

// vendor — central master, enabled per company via vendor_company.
@Entity({ tableName: 'vendor' })
export class Vendor extends BaseEntity {
  @Property({ unique: true })
  vendorCode!: string;

  @Property()
  name!: string;

  @Property({ length: 13, nullable: true })
  taxId?: string;

  @Property({ nullable: true })
  address?: string;

  @Property({ nullable: true })
  contactName?: string;

  @Property({ nullable: true })
  contactPhone?: string;

  @Property({ type: 'int', default: 30 })
  paymentTermDays: number = 30;

  @Property({ default: true })
  isActive: boolean = true;

  /**
   * Whether this vendor has any ACTIVE bank account — filled in by the registry read, never stored.
   *
   * `persist: false` rather than a plain assignment: MikroORM's serializer only emits properties it
   * knows about, so an ad-hoc field set on the entity is silently dropped on its way out and the
   * client never sees it.
   */
  @Property({ persist: false, nullable: true })
  hasBankAccount?: boolean;
}

/**
 * vendor_bank_account — a vendor's payee accounts; a vendor may hold several.
 *
 * Hangs off the group-level `Vendor`, so an account is visible to every company in the group: a
 * GROUP-scope read under invariant 1, no wider than the vendor's own name or tax id, and never a
 * cross-company write. The alternative — accounts per `vendor_company` — isolates better but makes
 * every company re-key the same supplier's account numbers, which is the retyping this exists to
 * remove.
 *
 * Mutations are gated by VENDOR_BANK_MANAGE, deliberately NOT VENDOR_MANAGE: redirecting a payee
 * account needs no approval, leaves no document, and pays out on the next run, so it must not ride
 * along with editing a vendor's phone number.
 */
@Entity({ tableName: 'vendor_bank_account' })
@Unique({ properties: ['vendor', 'bankCode', 'accountNo'] })
@Index({ properties: ['vendor'] })
export class VendorBankAccount extends BaseEntity {
  @ManyToOne(() => Vendor)
  vendor!: Vendor;

  @Property()
  bankCode!: string;

  // Always text: an account number is an identifier, not a quantity — as a number its leading
  // zeros vanish and long ones lose precision.
  @Property()
  accountNo!: string;

  @Property()
  accountName!: string;

  @ManyToOne(() => Currency, { fieldName: 'currency', nullable: true })
  currency?: Currency;

  // At most one ACTIVE primary per vendor; promoting one demotes the previous in the same
  // transaction. Enforced in the service — a partial unique index cannot express "active only".
  @Property({ default: false })
  isPrimary: boolean = false;

  // Deactivating hides the account from new selections but keeps it readable, so an approved
  // document or an exported batch that names it stays legible.
  @Property({ default: true })
  isActive: boolean = true;

  @Property({ columnType: 'timestamptz', nullable: true })
  createdAt?: Date;

  @Property({ columnType: 'timestamptz', nullable: true })
  updatedAt?: Date;
}

/**
 * vendor_bank_account_log — who changed a payee account, when, and from what to what.
 *
 * vendor_bank_account is not an append-only ledger, so an edit-pay-revert sequence would otherwise
 * leave no trace at all. This log is the only thing that makes it detectable after the fact.
 */
@Entity({ tableName: 'vendor_bank_account_log' })
@Index({ properties: ['vendorBankAccount'] })
export class VendorBankAccountLog extends BaseEntity {
  @ManyToOne(() => VendorBankAccount, { fieldName: 'vendor_bank_account_id' })
  vendorBankAccount!: VendorBankAccount;

  @ManyToOne(() => AppUser, { fieldName: 'actor_id' })
  actor!: AppUser;

  @Property()
  action!: string; // CREATE / UPDATE / SET_PRIMARY / DEACTIVATE

  @Property({ type: 'text', nullable: true })
  beforeJson?: string;

  @Property({ type: 'text', nullable: true })
  afterJson?: string;

  @Property({ columnType: 'timestamptz', nullable: true })
  actedAt?: Date;
}

@Entity({ tableName: 'vendor_company' })
@Unique({ properties: ['vendor', 'company'] })
export class VendorCompany extends CompanyScopedEntity {
  @ManyToOne(() => Vendor)
  vendor!: Vendor;

  @ManyToOne(() => Company)
  company!: Company;

  @Property({ default: true })
  isActive: boolean = true;

  @Property({ columnType: 'date', nullable: true })
  approvedDate?: string;

  // Per-company override of the group vendor's payment terms; null = use vendor.paymentTermDays.
  @Property({ type: 'int', nullable: true })
  paymentTermDays?: number;
}

// item — central master, enabled per company via item_company.
@Entity({ tableName: 'item' })
export class Item extends BaseEntity {
  @Property({ unique: true })
  itemCode!: string;

  @Property()
  name!: string;

  @Property({ nullable: true })
  category?: string;

  @Property({ nullable: true })
  defaultUnit?: string;

  /**
   * Whether this is a physical good whose quantity is tracked in a warehouse. Lives on the group
   * `item` and not on `item_company` because being a physical thing is a property of the thing,
   * not of a company's relationship to it — per-company control is already `ItemCompany.isActive`.
   *
   * Defaults false so every existing item, document type, and receipt behaves exactly as before
   * until a company opts in.
   */
  @Property({ default: false })
  isStockTracked: boolean = false;

  @Property({ default: true })
  isActive: boolean = true;
}

@Entity({ tableName: 'item_company' })
@Unique({ properties: ['item', 'company'] })
export class ItemCompany extends CompanyScopedEntity {
  @ManyToOne(() => Item)
  item!: Item;

  @ManyToOne(() => Company)
  company!: Company;

  @Property({ default: true })
  isActive: boolean = true;

  /**
   * The item's GL for this company — the account documents stamp and the ledger debits.
   *
   * Stamped from the budget bound below rather than typed in, and left alone when that binding is
   * cleared: an item that posts today does not stop posting because a label was removed. Reading it
   * from the bound budget instead would make every GL read depend on the open fiscal year resolving,
   * turning a year-end gap into documents that cannot be submitted.
   */
  @Property({ nullable: true })
  defaultGlAccount?: string;

  /**
   * The budget this item belongs to in this company, held as its place IN THE PLAN — the plan code
   * the organisation says out loud ("6.101") — never as a `budget.id`.
   *
   * `budget` and `budget_node` are both keyed by fiscal year, so a stored id would name a closed
   * year's row the moment a new year opens, and every item in the registry would need re-pointing
   * each January. A code keeps meaning the same budget across years: `budget_node` is unique on
   * `(fiscal_year_id, code)`, so within the open year a code resolves to exactly one node — and
   * `budget.node_id` is unique, so to exactly one budget. The department is not part of the key; it
   * is a label the picker shows, and the node does not carry one at all.
   *
   * Null = the item names no budget. It may still carry an account it was enabled with before this
   * existed: one account is shared by several budgets, so no binding can be derived from it.
   */
  @Property({ nullable: true })
  defaultBudgetCode?: string;
}
