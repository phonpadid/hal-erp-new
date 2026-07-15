import { Entity, ManyToOne, Property, Unique } from '@mikro-orm/core';
import { BaseEntity, CompanyScopedEntity } from '../../common/entities/base.entity';
import { Currency } from '../currency/currency.entities';

// company — one row per legal entity; every main table references it (invariant 1).
@Entity({ tableName: 'company' })
export class Company extends BaseEntity {
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
