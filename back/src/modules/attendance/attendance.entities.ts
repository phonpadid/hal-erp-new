import { Entity, Enum, Index, ManyToOne, OptionalProps, Property, Unique } from '@mikro-orm/core';
import { BaseEntity, CompanyScopedEntity } from '../../common/entities/base.entity';
import {
  AttendanceDayStatus,
  AttendanceDirection,
  AttendanceSource,
  ControlPolicy,
  GeofenceStatus,
} from '../../common/enums';
import { Company } from '../multi-company/multi-company.entities';
import { AppUser, Employee } from '../rbac/rbac.entities';

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

/**
 * attendance_event — the punch. The fourth ledger of a shape this codebase already knows
 * (`budget_txn`, `approval_log`, the GL journal, `stock_txn`): append-only, guarded by
 * `LedgerGuardSubscriber`, corrected by writing new rows rather than editing old ones.
 *
 * The separation from judgement is the point of the whole module. A punch is an observation of
 * the world; "late" is an opinion about it. Observations are recorded faithfully and never
 * revised, so the daily projection can be rebuilt whenever the rules or the configuration change
 * without ever putting someone's actual arrival time at risk.
 *
 * This is also the first table here whose row count grows with headcount and time rather than
 * with documents — roughly 150k rows per hundred employees per year — so the indexes below are
 * chosen for the queries that will exist, not added later.
 */
@Entity({ tableName: 'attendance_event' })
// The daily projection's constant question: every punch for this person on this day.
@Index({ properties: ['company', 'employee', 'localDate'] })
// The supervisor board's question: everyone today.
@Index({ properties: ['company', 'localDate'] })
export class AttendanceEvent extends CompanyScopedEntity {
  [OptionalProps]?: 'geofenceStatus' | 'createdAt';

  @ManyToOne(() => Company)
  company!: Company;

  @ManyToOne(() => Employee)
  employee!: Employee;

  /** The instant. Self-service stamps the server clock; the client never supplies it. */
  @Property({ columnType: 'timestamptz' })
  occurredAt!: Date;

  /**
   * The company-local calendar day `occurredAt` fell on, stamped at insert and never derived at
   * read. `company.timezone` is editable master data: deriving this would mean that correcting a
   * company's zone silently moved every punch near a midnight boundary to a different day, along
   * with every lateness figure already reported from it. Same reasoning that locks
   * `document.exchange_rate` at submit — the interpretation in force when the event happened is
   * part of the event.
   */
  @Property({ columnType: 'date' })
  localDate!: string;

  /**
   * What the client said it was. Capture does not infer direction from parity and does not reject
   * an IN that follows an IN: the daily projection uses only the first and last punch of a day, so
   * a mis-pressed button in the middle changes nothing, and refusing "impossible" sequences would
   * be a judgement — which is what this layer exists not to make.
   */
  @Enum({ items: () => AttendanceDirection })
  direction!: AttendanceDirection;

  @Enum({ items: () => AttendanceSource })
  source!: AttendanceSource;

  /**
   * The nearest active location the punch was measured against; null when status is UNKNOWN.
   * `no action` rather than the ORM's default `set null`: a check constraint ties this column to
   * `distanceMeters`, so blanking it on a delete would leave a half-recorded measurement that
   * violates it. Locations are deactivated, never hard-deleted, so this only guards surprises.
   */
  @ManyToOne(() => WorkLocation, { nullable: true, deleteRule: 'no action' })
  workLocation?: WorkLocation;

  @Property({ type: 'decimal', precision: 9, scale: 6, nullable: true })
  latitude?: string;

  @Property({ type: 'decimal', precision: 9, scale: 6, nullable: true })
  longitude?: string;

  /**
   * Distance to the nearest location, recorded whether or not it passed. A geofence is an audit
   * aid, not an access control, so the measurement is worth more than the verdict.
   */
  @Property({ type: 'int', nullable: true })
  distanceMeters?: number;

  @Enum({ items: () => GeofenceStatus, default: GeofenceStatus.UNKNOWN })
  geofenceStatus: GeofenceStatus = GeofenceStatus.UNKNOWN;

  @Property({ nullable: true })
  deviceId?: string;

  @Property({ type: 'text', nullable: true })
  remark?: string;

  /**
   * Who entered this on someone else's behalf; null when the employee punched for themselves.
   * The set of rows with a non-null value is exactly the set of manual entries, and because the
   * ledger cannot be edited, that set is trustworthy.
   *
   * `no action` on delete, not the ORM's default `set null`: a check constraint requires this to
   * be present exactly when `source` is MANUAL, so blanking it would both violate that and
   * destroy the only record of who made a hand entry. Deleting such a user is refused instead.
   */
  @ManyToOne(() => AppUser, { fieldName: 'recorded_by', nullable: true, deleteRule: 'no action' })
  recordedBy?: AppUser;

  /** The row this one supersedes. The superseded row stays readable forever. */
  @ManyToOne(() => AttendanceEvent, { nullable: true, deleteRule: 'no action' })
  correctsEvent?: AttendanceEvent;

  @Property({ columnType: 'timestamptz' })
  createdAt: Date = new Date();
}

/**
 * attendance_day — the join of expectation and observation, one row per employee per SHIFT day.
 *
 * A projection, not a ledger. It stands to `attendance_event` exactly as `stock_balance` stands to
 * `stock_txn`: the ledger is the truth, this exists so nobody aggregates it on every read, and
 * replaying the ledger must reproduce this row exactly (invariant 3). It is deliberately absent
 * from `LedgerGuardSubscriber` — recomputation has to be able to overwrite it.
 *
 * `shiftDate` is the day of the SHIFT, not of the punch. A 22:00-06:00 night shift for the 1st
 * consumes punches from both the 1st and the morning of the 2nd; grouping by the punch's own
 * `localDate` would split it into two half-days and mark both incomplete.
 *
 * The shift is snapshotted here and judged against the copy; the holiday calendar is not and is
 * re-read on every recompute. That asymmetry is deliberate — see the class comment on the status
 * enum and the note in the DBML: editing shift hours is a decision about the future and must not
 * rewrite past verdicts, while a retroactively declared public holiday corrects a misstatement
 * about the past and should.
 */
@Entity({ tableName: 'attendance_day' })
@Unique({ properties: ['company', 'employee', 'shiftDate'] })
@Index({ properties: ['company', 'shiftDate'] })
export class AttendanceDay extends CompanyScopedEntity {
  [OptionalProps]?:
    | 'punchCount'
    | 'workedMinutes'
    | 'lateMinutes'
    | 'lateOccurrences'
    | 'earlyLeaveMinutes'
    | 'otNormalMinutes'
    | 'holidayWorkMinutes'
    | 'otHolidayMinutes'
    | 'computedAt';

  @ManyToOne(() => Company)
  company!: Company;

  @ManyToOne(() => Employee)
  employee!: Employee;

  @Property({ columnType: 'date' })
  shiftDate!: string;

  // --- snapshot of the shift as it stood when this row was computed ---

  @Property({ nullable: true })
  shiftCode?: string;

  /** That day's effective start, per-weekday override already applied (e.g. a short Saturday). */
  @Property({ type: 'smallint', nullable: true })
  expectedInMinute?: number;

  @Property({ type: 'smallint', nullable: true })
  expectedOutMinute?: number;

  /** Expected working minutes for this day; 0 when it is not a working day. */
  @Property({ type: 'smallint', nullable: true })
  expectedMinutes?: number;

  // --- what the ledger showed ---

  @Property({ columnType: 'timestamptz', nullable: true })
  firstInAt?: Date;

  @Property({ columnType: 'timestamptz', nullable: true })
  lastOutAt?: Date;

  @Property({ type: 'int', default: 0 })
  punchCount: number = 0;

  // --- the comparison ---

  /** First to last punch, less the overlap with the break window — never a flat deduction. */
  @Property({ type: 'int', default: 0 })
  workedMinutes: number = 0;

  /**
   * Measured from the expected start, not from the end of grace: grace decides *whether* someone
   * is late, it does not reduce by how much.
   */
  @Property({ type: 'int', default: 0 })
  lateMinutes: number = 0;

  /**
   * 0 or 1 per day. Kept alongside lateMinutes because the two answer different questions: pay
   * deductions count minutes, while the disciplinary rule Thai companies actually run ("late three
   * times this month") counts occurrences. Storing one loses the other.
   */
  @Property({ type: 'smallint', default: 0 })
  lateOccurrences: number = 0;

  @Property({ type: 'int', default: 0 })
  earlyLeaveMinutes: number = 0;

  // --- raw overtime, split by the three kinds Thai law prices differently ---
  // Split at computation because a total cannot be unsplit afterwards. No multiplier is stored
  // anywhere: this platform spans jurisdictions, so it exports hours by kind and lets whatever
  // prices them apply the rates (invariant 7).

  @Property({ type: 'int', default: 0 })
  otNormalMinutes: number = 0;

  @Property({ type: 'int', default: 0 })
  holidayWorkMinutes: number = 0;

  @Property({ type: 'int', default: 0 })
  otHolidayMinutes: number = 0;

  @Enum({ items: () => AttendanceDayStatus })
  status!: AttendanceDayStatus;

  /**
   * When these numbers were produced. Exposed on every read so a caller can see the projection's
   * age rather than assume freshness — and the anchor a future period close can freeze against
   * without migrating existing history.
   */
  @Property({ columnType: 'timestamptz' })
  computedAt: Date = new Date();
}
