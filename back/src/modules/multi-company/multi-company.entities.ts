import { Entity, ManyToOne, OptionalProps, Property, Unique } from '@mikro-orm/core';
import { BaseEntity, CompanyScopedEntity } from '../../common/entities/base.entity';
import { Currency } from '../currency/currency.entities';
import type { WorkShift } from '../attendance/attendance.entities';

// company — one row per legal entity; every main table references it (invariant 1).
@Entity({ tableName: 'company' })
export class Company extends BaseEntity {
  // Carries a database default, so callers need not supply it on create.
  [OptionalProps]?: 'timezone' | 'overtimeWeeklyLimitMinutes' | 'correctionWindowDays';

  @Property({ unique: true })
  code!: string;

  @Property()
  nameTh!: string;

  @Property({ nullable: true })
  nameEn?: string;

  @Property({ length: 13, nullable: true })
  taxId?: string;

  @Property({ length: 5, default: '00000' })
  branchCode: string = '00000';

  @ManyToOne(() => Currency, { fieldName: 'base_currency', nullable: true })
  baseCurrency?: Currency;

  // IANA zone name (Asia/Bangkok, Asia/Vientiane). Defines when this company's calendar days
  // begin and end, so anything deciding which day a moment belongs to resolves it here instead
  // of assuming UTC. At UTC+7 a punch at 06:30 local is 23:30 UTC the previous day.
  @Property({ default: 'Asia/Bangkok' })
  timezone: string = 'Asia/Bangkok';

  /**
   * Weekly ceiling on overtime plus holiday work, in minutes. 2160 is the 36 hours Thai law
   * allows. Configuration rather than a constant because Lao law differs and this platform serves
   * both — and deliberately NOT a quota: `quota_entitlement` is keyed by year and cannot hold 52
   * weekly entitlements, and the shape is wrong anyway. This is a limit on what an employer may
   * ask for, identical for everyone, never carried forward, and nobody asks how much of it is
   * left.
   */
  @Property({ type: 'int', default: 2160 })
  overtimeWeeklyLimitMinutes: number = 2160;

  /**
   * How many days back a time correction may reach, measured from the shift day being corrected
   * rather than from the day the request is raised — which is what "you may correct the last 30
   * days" means to a person. Its real purpose arrives with period close; until then it stops a
   * correction reopening arbitrarily old attendance.
   */
  @Property({ type: 'int', default: 30 })
  correctionWindowDays: number = 30;

  @Property({ default: true })
  isActive: boolean = true;

  // Object key (S3/MinIO) for the company's 1:1 profile image/logo; bytes never in the DB.
  @Property({ nullable: true })
  profileImagePath?: string;

  // Letterhead contact block — printed in the document PDF's bottom contact footer. Nullable;
  // a company without these still exports (the footer band degrades line by line).
  @Property({ nullable: true })
  address?: string;

  @Property({ nullable: true })
  phone?: string;

  @Property({ nullable: true })
  email?: string;

  @Property({ nullable: true })
  website?: string;

  @Property({ columnType: 'timestamptz', nullable: true })
  createdAt?: Date;
}

// department — tree (ฝ่าย > แผนก > หน่วยงาน) scoped to a company.
@Entity({ tableName: 'department' })
@Unique({ properties: ['company', 'deptCode'] })
export class Department extends CompanyScopedEntity {
  [OptionalProps]?: 'attendanceAffectsPay';

  @ManyToOne(() => Company)
  company!: Company;

  @Property()
  deptCode!: string;

  @Property()
  name!: string;

  @ManyToOne(() => Department, { fieldName: 'parent_dept_id', nullable: true })
  parentDept?: Department;

  @Property({ nullable: true })
  costCenter?: string;

  /**
   * The shift expected of this department's employees who carry no individual `employee_shift`.
   * Must reference a `work_shift` of the same company. Deliberately has no effective date range:
   * a default is "what most people here work now", while the history that matters is per person
   * and lives on the dated per-employee assignment.
   *
   * Referenced by name (not by import) so this foundational module keeps no runtime dependency
   * on the downstream attendance module — the same shape `document.warehouse` uses.
   */
  @ManyToOne('WorkShift', { fieldName: 'default_work_shift_id', nullable: true })
  defaultWorkShift?: WorkShift;

  /**
   * Whether attendance drives pay for this department. False still measures discipline — lateness
   * and absence are counted exactly the same — it only says the figures are not what payroll acts
   * on. A department-level default with a per-person override is the shape `defaultWorkShift`
   * already uses, for the same reason: the policy is usually departmental and occasionally personal.
   */
  @Property({ type: 'boolean', default: true })
  attendanceAffectsPay: boolean = true;

  @Property({ default: true })
  isActive: boolean = true;
}

@Entity({ tableName: 'fiscal_year' })
@Unique({ properties: ['company', 'year'] })
export class FiscalYear extends CompanyScopedEntity {
  @ManyToOne(() => Company)
  company!: Company;

  @Property({ type: 'int' })
  year!: number;

  @Property({ columnType: 'date' })
  startDate!: string;

  @Property({ columnType: 'date' })
  endDate!: string;

  @Property({ default: 'OPEN' })
  status: string = 'OPEN';
}

// holiday_calendar — per-company holidays for SLA day-counting.
@Entity({ tableName: 'holiday_calendar' })
@Unique({ properties: ['company', 'holidayDate'] })
export class HolidayCalendar extends CompanyScopedEntity {
  @ManyToOne(() => Company)
  company!: Company;

  @Property({ columnType: 'date' })
  holidayDate!: string;

  @Property()
  name!: string;
}
