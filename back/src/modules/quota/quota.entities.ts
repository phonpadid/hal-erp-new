import { Entity, Index, ManyToOne, Property, Unique } from '@mikro-orm/core';
import { BaseEntity, CompanyScopedEntity } from '../../common/entities/base.entity';
import { Document } from '../document/document.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { Employee } from '../rbac/rbac.entities';

// quota — money or non-money allowance (leave days, OT hours, booking counts).
@Entity({ tableName: 'quota' })
export class Quota extends CompanyScopedEntity {
  @ManyToOne(() => Company)
  company!: Company;

  // null = company-level quota.
  @ManyToOne(() => Department, { nullable: true })
  department?: Department;

  @Property()
  quotaType!: string;

  @Property()
  unit!: string;

  @Property({ type: 'decimal', precision: 15, scale: 2 })
  limitValue!: string;

  @Property({ default: 'YEARLY' })
  resetCycle: string = 'YEARLY';

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
