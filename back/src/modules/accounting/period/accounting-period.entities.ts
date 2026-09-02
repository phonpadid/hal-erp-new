import { Entity, Enum, Index, ManyToOne, OptionalProps, Property, Unique } from '@mikro-orm/core';
import { BaseEntity, CompanyScopedEntity } from '../../../common/entities/base.entity';
import { AccountingPeriodStatus, PeriodAction } from '../../../common/enums';
import { Company, FiscalYear } from '../../multi-company/multi-company.entities';
import { AppUser } from '../../rbac/rbac.entities';

/**
 * accounting_period — a company's book month: a declared date range that can be closed.
 *
 * The same shape as `attendance_period`, deliberately: two ledgers, one question, and whoever finds
 * one of them should be told the other exists. The range is explicit rather than derived from a
 * year and a month, because a company whose books do not run on calendar months could not express
 * itself otherwise — the lesson `quota_entitlement` taught by keying on the year.
 *
 * A row whose STATUS is meant to change, so it is deliberately absent from
 * `LedgerGuardSubscriber`. Its history lives in `AccountingPeriodLog`, which is not.
 */
@Entity({ tableName: 'accounting_period' })
@Unique({ properties: ['company', 'code'] })
@Index({ properties: ['company', 'periodStart'] })
export class AccountingPeriod extends CompanyScopedEntity {
  [OptionalProps]?: 'status';

  @ManyToOne(() => Company)
  company!: Company;

  /** A period belongs to one fiscal year, and its range must fall inside that year. */
  @ManyToOne(() => FiscalYear)
  fiscalYear!: FiscalYear;

  /** What people call it, e.g. `2026-08`. The dates below are what the code reads. */
  @Property()
  code!: string;

  @Property({ columnType: 'date' })
  periodStart!: string;

  @Property({ columnType: 'date' })
  periodEnd!: string;

  @Enum({ items: () => AccountingPeriodStatus })
  status: AccountingPeriodStatus = AccountingPeriodStatus.OPEN;

  @Property({ columnType: 'timestamptz', nullable: true })
  createdAt?: Date = new Date();

  @Property({ columnType: 'timestamptz', nullable: true, onUpdate: () => new Date() })
  updatedAt?: Date = new Date();
}

/**
 * accounting_period_log — who closed or reopened a period, when, and why.
 *
 * APPEND-ONLY, enforced by `LedgerGuardSubscriber` beside `attendance_period_log`. This is where
 * "who reopened August, and for what reason" is answered — and a history that can be edited answers
 * nothing. The current status lives on the period; this is what happened to it.
 *
 * Not company-scoped directly: it hangs off a period that is, and scoping it twice would mean two
 * places to keep in step.
 */
@Entity({ tableName: 'accounting_period_log' })
@Index({ properties: ['period', 'actedAt'] })
export class AccountingPeriodLog extends BaseEntity {
  @ManyToOne(() => AccountingPeriod)
  period!: AccountingPeriod;

  @Enum({ items: () => PeriodAction })
  action!: PeriodAction;

  @ManyToOne(() => AppUser, { fieldName: 'acted_by' })
  actedBy!: AppUser;

  @Property({ columnType: 'timestamptz' })
  actedAt: Date = new Date();

  /** Required on REOPEN: reopening a month that has been reported should cost a sentence. */
  @Property({ type: 'text', nullable: true })
  reason?: string;
}
