import { Entity, ManyToOne, OptionalProps, Property, Unique } from '@mikro-orm/core';
import { BaseEntity, CompanyScopedEntity } from '../../common/entities/base.entity';
import { Currency } from '../currency/currency.entities';
import type { WorkShift } from '../attendance/attendance.entities';

// company — one row per legal entity; every main table references it (invariant 1).
@Entity({ tableName: 'company' })
export class Company extends BaseEntity {
  // Carries a database default, so callers need not supply it on create.
  [OptionalProps]?: 'timezone';

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
