import { Entity, Enum, Index, ManyToOne, OptionalProps, Property, Unique } from '@mikro-orm/core';
import { BaseEntity, CompanyScopedEntity } from '../../common/entities/base.entity';
import { ControlPolicy } from '../../common/enums';
import { Company } from '../multi-company/multi-company.entities';
import { Employee } from '../rbac/rbac.entities';

/** Minutes in a day. An `endMinute` above this ends on the following calendar day. */
export const MINUTES_PER_DAY = 1440;

/**
 * work_shift — the hours a company expects of an employee. Per-company master (invariant 1),
 * configuration rather than code (invariant 7).
 *
 * Times are minutes counted from local midnight, not `time` columns. A 22:00-06:00 night shift
 * is startMinute 1320 / endMinute 1800: duration is `end - start` with no branch, and "crosses
 * midnight" is derived from `endMinute > MINUTES_PER_DAY` rather than stored. A stored flag can
 * contradict the times it describes; a derived one cannot.
 *
 * The four values a future `attendance_day` snapshots to judge a day — expected in, expected
 * out, expected minutes, shift code — are all flat scalars here. That is deliberate: the daily
 * row must judge against a copy, never re-read this table, or HR moving the office start time in
 * July would retroactively un-late everyone who arrived at 08:15 in June.
 */
@Entity({ tableName: 'work_shift' })
@Unique({ properties: ['company', 'code'] })
@Index({ properties: ['company'] })
export class WorkShift extends CompanyScopedEntity {
  // Derived (see the getter below) and defaulted columns — none are supplied on create.
  [OptionalProps]?: 'crossesMidnight' | 'graceMinutes' | 'otMinMinutes' | 'otRoundMinutes' | 'isActive';

  @ManyToOne(() => Company)
  company!: Company;

  @Property()
  code!: string;

  @Property()
  name!: string;

  @Property({ type: 'smallint' })
  startMinute!: number;

  // May exceed MINUTES_PER_DAY to express a shift ending the next day. Always > startMinute.
  @Property({ type: 'smallint' })
  endMinute!: number;

  // The unpaid break as an interval, not a duration: a later daily computation deducts only the
  // overlap between the interval actually worked and this window, so an employee on approved
  // morning-half leave who works 13:00-17:00 is never charged for a 12:00-13:00 break.
  @Property({ type: 'smallint', nullable: true })
  breakStartMinute?: number;

  @Property({ type: 'smallint', nullable: true })
  breakEndMinute?: number;

  // Paid working minutes of a full day, break excluded.
  @Property({ type: 'smallint' })
  standardMinutes!: number;

  // Arrive within this many minutes of the start and you are not late.
  @Property({ type: 'smallint', default: 15 })
  graceMinutes: number = 15;

  // Arrive more than this many minutes after the start and the half day is lost.
  @Property({ type: 'smallint' })
  halfDayThresholdMinutes!: number;

  // Overtime below this floor is ignored; above it, rounded DOWN to otRoundMinutes blocks.
  @Property({ type: 'smallint', default: 30 })
  otMinMinutes: number = 30;

  @Property({ type: 'smallint', default: 30 })
  otRoundMinutes: number = 30;

  @Property({ default: true })
  isActive: boolean = true;

  /**
   * Derived, never stored: the shift ends on the day after it starts. `persist: false` keeps it
   * out of the table while still serializing it to API responses — the point of decision 1 is
   * that this value has exactly one source, the times themselves.
   */
  @Property({ persist: false })
  get crossesMidnight(): boolean {
    return this.endMinute > MINUTES_PER_DAY;
  }
}

/**
 * work_shift_day — which weekdays a shift works, and optionally at what hours.
 *
 * A table rather than a bitmask or seven booleans because Saturday half-day (Mon-Fri
 * 08:00-17:00, Sat 08:00-12:00) is not an on/off state — Saturday has different hours. No
 * "which days" flag can express that, and modelling it as a second shift fails because
 * assignment is per employee, not per weekday. A weekday with no row is non-working.
 */
@Entity({ tableName: 'work_shift_day' })
@Unique({ properties: ['workShift', 'weekday'] })
export class WorkShiftDay extends BaseEntity {
  [OptionalProps]?: 'isWorking';

  // Cascade: the weekday pattern has no meaning apart from its shift, and a shift that is still
  // in use cannot be hard-deleted anyway (the service blocks it), so this only fires for a shift
  // that was never assigned.
  @ManyToOne(() => WorkShift, { deleteRule: 'cascade' })
  workShift!: WorkShift;

  // ISO weekday: 1 = Monday ... 7 = Sunday.
  @Property({ type: 'smallint' })
  weekday!: number;

  @Property({ default: true })
  isWorking: boolean = true;

  // Null means "use the parent shift's value" for this day.
  @Property({ type: 'smallint', nullable: true })
  startMinute?: number;

  @Property({ type: 'smallint', nullable: true })
  endMinute?: number;
}

/**
 * employee_shift — binds a person to a shift over a date range. Fixed assignment, not a
 * rotating roster. `effectiveTo` null means open-ended.
 *
 * Two rows for the same employee must not cover the same date. PostgreSQL could enforce that
 * with an EXCLUDE constraint over a daterange, but that needs the btree_gist extension; the
 * check runs in the service inside the write transaction instead, so two concurrent assignments
 * cannot both pass it.
 */
@Entity({ tableName: 'employee_shift' })
@Unique({ properties: ['employee', 'effectiveFrom'] })
@Index({ properties: ['company', 'employee', 'effectiveFrom'] })
export class EmployeeShift extends CompanyScopedEntity {
  @ManyToOne(() => Company)
  company!: Company;

  @ManyToOne(() => Employee)
  employee!: Employee;

  @ManyToOne(() => WorkShift)
  workShift!: WorkShift;

  @Property({ columnType: 'date' })
  effectiveFrom!: string;

  @Property({ columnType: 'date', nullable: true })
  effectiveTo?: string;
}

/**
 * work_location — a geofence a later attendance capture is checked against. Defined here with
 * no enforcement so the capture slice has configured targets on the day it lands.
 *
 * `controlPolicy` reuses the budget over-limit enum because the situation is identical in shape:
 * a configured limit, a value outside it, and a per-row choice between blocking and recording.
 * SOFT_WARNING is the default — indoor GPS error of 50-200 m is routine, and a system that
 * blocks on it pushes every morning through manual entry until the geofence means nothing.
 *
 * Coordinates are decimal(9,6) (~0.11 m) carried as strings: no value of consequence in this
 * codebase rides on a JS float.
 */
@Entity({ tableName: 'work_location' })
@Unique({ properties: ['company', 'code'] })
@Index({ properties: ['company'] })
export class WorkLocation extends CompanyScopedEntity {
  [OptionalProps]?: 'controlPolicy' | 'isActive';

  @ManyToOne(() => Company)
  company!: Company;

  @Property()
  code!: string;

  @Property()
  name!: string;

  @Property({ type: 'decimal', precision: 9, scale: 6 })
  latitude!: string;

  @Property({ type: 'decimal', precision: 9, scale: 6 })
  longitude!: string;

  @Property({ type: 'int' })
  radiusMeters!: number;

  @Enum({ items: () => ControlPolicy, default: ControlPolicy.SOFT_WARNING })
  controlPolicy: ControlPolicy = ControlPolicy.SOFT_WARNING;

  @Property({ default: true })
  isActive: boolean = true;
}
