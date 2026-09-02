import { Entity, Enum, Index, ManyToOne, OptionalProps, Property, Unique } from '@mikro-orm/core';
import { BaseEntity, CompanyScopedEntity } from '../../common/entities/base.entity';
import { ControlPolicy } from '../../common/enums';
import { Document } from '../document/document.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { Employee } from '../rbac/rbac.entities';

// quota — money or non-money allowance (leave days, OT hours, booking counts).
@Entity({ tableName: 'quota' })
export class Quota extends CompanyScopedEntity {
  // Both carry defaults that reproduce pre-existing behaviour, so no fixture needs to supply them.
  [OptionalProps]?: 'controlPolicy' | 'resetCycle' | 'carryForward' | 'isActive';

  @ManyToOne(() => Company)
  company!: Company;

  // null = company-level quota.
  @ManyToOne(() => Department, { nullable: true })
  department?: Department;

  @Property()
  quotaType!: string;

  @Property()
  unit!: string;

  /** The ceiling on how much may be TAKEN. */
  @Property({ type: 'decimal', precision: 15, scale: 2 })
  limitValue!: string;

  /**
   * The ceiling up to which usage is COMPENSATED, separate from how much may be taken. Null means
   * the whole limit is paid, which is what every quota meant before this column existed.
   *
   * Separate from `limitValue` because the paid boundary can fall inside a single request: an
   * employee who has used 28 days of a 30-day-paid sick quota and asks for 5 more takes 2 paid and
   * 3 unpaid. A boolean on the quota cannot express that. Maternity leave has the same shape —
   * 98 days allowed, 45 paid — which is the second witness that this is the right axis.
   *
   * Paid and unpaid are DERIVED from this against net usage, never stored per row (invariant 3).
   */
  @Property({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  paidLimitValue?: string;

  @Property({ default: 'YEARLY' })
  resetCycle: string = 'YEARLY';

  /**
   * What happens when a reservation would exceed remaining. The same enum budget uses, because
   * the situation keeps being identical in shape: a configured limit, a value beyond it, and a
   * per-row choice between refusing and recording.
   *
   * HARD_STOP blocks (annual leave: gone is gone). SOFT_WARNING records and warns — Thai law
   * entitles an employee to sick leave for as long as they are genuinely ill, so a system that
   * blocks at the paid ceiling is not implementing the law but contradicting it.
   *
   * Defaults to HARD_STOP so every quota that existed before this column behaves identically.
   */
  @Enum({ items: () => ControlPolicy, default: ControlPolicy.HARD_STOP })
  controlPolicy: ControlPolicy = ControlPolicy.HARD_STOP;

  // Allow rolling unused balance across reset periods (carry forward).
  @Property({ default: true })
  carryForward: boolean = true;

  @Property({ default: true })
  isActive: boolean = true;
}

// quota_usage — USE / RELEASE rows; reject/cancel auto-releases (invariant 5).
@Entity({ tableName: 'quota_usage' })
@Index({ properties: ['quota', 'periodYear', 'periodIndex'] })
export class QuotaUsage extends BaseEntity {
  @Index()
  @ManyToOne(() => Quota)
  quota!: Quota;

  @Index()
  @ManyToOne(() => Document)
  document!: Document;

  @ManyToOne(() => Employee, { nullable: true })
  employee?: Employee;

  @Property({ type: 'decimal', precision: 15, scale: 2 })
  qtyUsed!: string;

  @Property({ default: 'USE' })
  usageType: string = 'USE';

  // Reset period the row belongs to (stamped at reserve from the quota's reset_cycle).
  // YEARLY → index 1, QUARTERLY → 1-4, MONTHLY → 1-12, NONE → year 0 / index 0.
  @Property({ type: 'int', default: 0 })
  periodYear: number = 0;

  @Property({ type: 'smallint', default: 0 })
  periodIndex: number = 0;

  @Property({ columnType: 'timestamptz', nullable: true })
  createdAt?: Date;
}

// quota_entitlement — per-person entitlement incl. carry-forward.
@Entity({ tableName: 'quota_entitlement' })
@Unique({ properties: ['quota', 'employee', 'year'] })
export class QuotaEntitlement extends BaseEntity {
  @ManyToOne(() => Quota)
  quota!: Quota;

  @ManyToOne(() => Employee)
  employee!: Employee;

  @Property({ type: 'int' })
  year!: number;

  @Property({ type: 'decimal', precision: 15, scale: 2 })
  entitledValue!: string;

  @Property({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  carriedOver: string = '0';

  @Property({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  adjusted: string = '0';
}
