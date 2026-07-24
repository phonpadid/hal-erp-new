import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { AttendanceDirection, AttendanceSource, GeofenceStatus } from '../../common/enums';
import { paginate, type Paginated, type PaginationQueryDto } from '../../common/pagination/pagination';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { inTransaction, lockForUpdate } from '../../common/uow/unit-of-work';
import { Company } from '../multi-company/multi-company.entities';
import { AppUser, Employee } from '../rbac/rbac.entities';
import { AttendanceEvent, WorkLocation } from './attendance.entities';
import { localDateIn } from './company-clock';
import { GeofenceService } from './geofence.service';
import type {
  BulkPunchDto,
  ListAttendanceEventQueryDto,
  PunchForEmployeeDto,
  PunchSelfDto,
} from './dto/attendance-capture.dto';

const FILTER_OFF = { filters: { company: false } } as const;

/**
 * A second punch in the same direction inside this window is a double tap or a retried request,
 * not a decision. Far below any interval a human would deliberately produce.
 */
export const DEDUPE_WINDOW_SECONDS = 60;

/**
 * Records punches. Deliberately makes no judgement about them: it does not infer direction, does
 * not reject an IN that follows an IN, and does not read a shift. The daily projection uses only
 * the first and last punch of a day, so a mis-pressed button in the middle changes nothing — and
 * a capture layer that rejected "impossible" sequences would be destroying the evidence of a
 * problem instead of recording it.
 *
 * The one rejection is a duplicate inside DEDUPE_WINDOW_SECONDS, which is a defence against the
 * transport rather than an opinion about the employee's day.
 *
 * It deliberately does NOT consult `AttendancePeriodGuard`, and the absence is a decision rather
 * than an oversight. A punch whose shift date lands in a closed period is still recorded: a device
 * uploading yesterday's batch late must not lose it, and an inert row a reopen would pick up is
 * strictly better than a rejected one that is gone. What a closed period freezes is the projection,
 * not the ledger — recording what happened and deciding what it means are different acts, and only
 * the second has anything to be frozen about. Such rows are listed by the closed-period event read
 * so they are findable rather than silent.
 */
@Injectable()
export class AttendanceCaptureService {
  constructor(
    private readonly em: EntityManager,
    private readonly companyScope: CompanyScopeService,
    private readonly geofence: GeofenceService,
  ) {}

  /**
   * Punch as yourself. Takes no employee and no timestamp: the employee is resolved from the
   * caller's own account and the instant is the server's, so this path has no field that could
   * be bent into punching for somebody else.
   */
  async punchSelf(direction: AttendanceDirection, dto: PunchSelfDto): Promise<AttendanceEvent> {
    const companyId = RequestContext.companyId()!;
    const userId = RequestContext.userId();
    if (!userId) throw new BadRequestException('No authenticated user in context');

    const em = this.companyScope.forActiveCompany(companyId);
    const employee = await em.findOne(Employee, { user: userId });
    if (!employee) {
      throw new BadRequestException('Your account is not linked to an employee in this company');
    }

    if ((dto.latitude === undefined) !== (dto.longitude === undefined)) {
      throw new BadRequestException('Provide both latitude and longitude, or neither');
    }

    const locations = await this.geofence.activeLocations(em);
    // Evaluated before the transaction: a HARD_STOP rejection should not have opened one.
    const verdict = this.geofence.evaluate(dto.latitude, dto.longitude, locations);
    const timezone = await this.timezoneOf(em, companyId);

    return inTransaction(em, async (tem) => {
      await this.lockAndCheckDuplicate(tem, employee.id, direction, new Date());
      const occurredAt = new Date();
      return this.insert(tem, {
        companyId,
        employeeId: employee.id,
        occurredAt,
        localDate: localDateIn(occurredAt, timezone),
        direction,
        source: dto.source ?? AttendanceSource.WEB,
        latitude: dto.latitude,
        longitude: dto.longitude,
        verdict,
        deviceId: dto.deviceId,
        remark: dto.remark,
      });
    });
  }

  /**
   * Record a punch for another employee. Always MANUAL with the acting user in `recordedBy` —
   * which makes every hand-entered punch identifiable, and identifiable permanently, because the
   * ledger cannot be edited afterwards.
   */
  async punchFor(dto: PunchForEmployeeDto): Promise<AttendanceEvent> {
    const companyId = RequestContext.companyId()!;
    const actorId = RequestContext.userId();
    if (!actorId) throw new BadRequestException('No authenticated user in context');

    const em = this.companyScope.forActiveCompany(companyId);
    const employee = await this.requireActiveEmployee(em, dto.employeeId);
    const occurredAt = new Date(dto.occurredAt);
    const timezone = await this.timezoneOf(em, companyId);

    return inTransaction(em, async (tem) => {
      await this.lockAndCheckDuplicate(tem, employee.id, dto.direction, occurredAt);
      return this.insert(tem, {
        companyId,
        employeeId: employee.id,
        occurredAt,
        // Stamped from THIS row's instant, not from today — a backdated entry lands on the day it
        // happened, which is the only reason backdating is useful.
        localDate: localDateIn(occurredAt, timezone),
        direction: dto.direction,
        source: AttendanceSource.MANUAL,
        verdict: { status: GeofenceStatus.UNKNOWN },
        remark: dto.remark,
        recordedById: actorId,
      });
    });
  }

  /**
   * One direction and instant for a whole crew, in one transaction: a roll call is recorded
   * completely or not at all, because half a checked-in crew is worse than none.
   */
  async bulkPunch(dto: BulkPunchDto): Promise<AttendanceEvent[]> {
    const companyId = RequestContext.companyId()!;
    const actorId = RequestContext.userId();
    if (!actorId) throw new BadRequestException('No authenticated user in context');

    const unique = [...new Set(dto.employeeIds)];
    const em = this.companyScope.forActiveCompany(companyId);
    const occurredAt = new Date(dto.occurredAt);
    const timezone = await this.timezoneOf(em, companyId);

    return inTransaction(em, async (tem) => {
      const rows: AttendanceEvent[] = [];
      for (const employeeId of unique) {
        const employee = await this.requireActiveEmployee(tem, employeeId);
        await this.lockAndCheckDuplicate(tem, employee.id, dto.direction, occurredAt);
        rows.push(
          await this.insert(tem, {
            companyId,
            employeeId: employee.id,
            occurredAt,
            localDate: localDateIn(occurredAt, timezone),
            direction: dto.direction,
            source: AttendanceSource.MANUAL,
            verdict: { status: GeofenceStatus.UNKNOWN },
            remark: dto.remark,
            recordedById: actorId,
          }),
        );
      }
      return rows;
    });
  }

  /** Paged, company-scoped ledger read. */
  list(q: ListAttendanceEventQueryDto = {}): Promise<Paginated<AttendanceEvent>> {
    const em = this.companyScope.forActiveCompany();
    const where: Record<string, unknown> = {};
    if (q.employeeId) where.employee = q.employeeId;
    if (q.source) where.source = q.source;
    if (q.geofenceStatus) where.geofenceStatus = q.geofenceStatus;
    if (q.manualOnly) where.recordedBy = { $ne: null };
    if (q.dateFrom || q.dateTo) {
      where.localDate = {
        ...(q.dateFrom ? { $gte: q.dateFrom.slice(0, 10) } : {}),
        ...(q.dateTo ? { $lte: q.dateTo.slice(0, 10) } : {}),
      };
    }
    return paginate(
      em,
      AttendanceEvent,
      where,
      { orderBy: { occurredAt: 'ASC' }, populate: ['workLocation'] },
      q as PaginationQueryDto,
    );
  }

  /**
   * The caller's own punches for a local date, so a client can show whether it already registered
   * a check-in. Resolves the employee from the account, so it cannot reach anyone else.
   */
  async listOwn(date?: string): Promise<AttendanceEvent[]> {
    const companyId = RequestContext.companyId()!;
    const userId = RequestContext.userId();
    if (!userId) throw new BadRequestException('No authenticated user in context');

    const em = this.companyScope.forActiveCompany(companyId);
    const employee = await em.findOne(Employee, { user: userId });
    if (!employee) {
      throw new BadRequestException('Your account is not linked to an employee in this company');
    }
    const timezone = await this.timezoneOf(em, companyId);
    const localDate = date ? date.slice(0, 10) : localDateIn(new Date(), timezone);
    return em.find(
      AttendanceEvent,
      { employee: employee.id, localDate },
      { orderBy: { occurredAt: 'ASC' }, populate: ['workLocation'] },
    );
  }

  /**
   * Lock the employee row, then look for a recent duplicate. The lock is what makes the check
   * real: at READ COMMITTED the read alone would let two retried requests both find nothing and
   * both insert. Same pattern as budget reservation, applied to a different scarce resource — in
   * this case the employee's own timeline.
   */
  private async lockAndCheckDuplicate(
    tem: EntityManager,
    employeeId: string,
    direction: AttendanceDirection,
    occurredAt: Date,
  ): Promise<void> {
    await lockForUpdate(tem, Employee, { id: employeeId }, FILTER_OFF);
    const since = new Date(occurredAt.getTime() - DEDUPE_WINDOW_SECONDS * 1000);
    const until = new Date(occurredAt.getTime() + DEDUPE_WINDOW_SECONDS * 1000);
    const recent = await tem.findOne(
      AttendanceEvent,
      { employee: employeeId, direction, occurredAt: { $gte: since, $lte: until } },
      FILTER_OFF,
    );
    if (recent) {
      throw new BadRequestException(
        `A ${direction} punch was already recorded within ${DEDUPE_WINDOW_SECONDS} seconds`,
      );
    }
  }

  /** An employee of this company who may be punched for. */
  private async requireActiveEmployee(em: EntityManager, employeeId: string): Promise<Employee> {
    const companyId = RequestContext.companyId()!;
    const employee = await em.findOne(
      Employee,
      { id: employeeId, company: companyId },
      FILTER_OFF,
    );
    if (!employee) throw new BadRequestException(`Unknown employee '${employeeId}'`);
    // attendance_required is NOT checked: it governs absence reporting, not capture. An exempt
    // executive who taps check-in produced a real observation and it is stored like any other.
    if (employee.status !== 'ACTIVE') {
      throw new BadRequestException(
        `Employee '${employee.empCode}' is ${employee.status}; attendance cannot be recorded`,
      );
    }
    return employee;
  }

  /** The company's IANA zone — the thing that decides which day a punch belongs to. */
  private async timezoneOf(em: EntityManager, companyId: string): Promise<string> {
    const company = await em.findOne(Company, { id: companyId }, FILTER_OFF);
    if (!company) throw new BadRequestException(`Unknown company '${companyId}'`);
    return company.timezone;
  }

  private async insert(
    tem: EntityManager,
    input: {
      companyId: string;
      employeeId: string;
      occurredAt: Date;
      localDate: string;
      direction: AttendanceDirection;
      source: AttendanceSource;
      verdict: { workLocation?: WorkLocation; distanceMeters?: number; status: GeofenceStatus };
      latitude?: string;
      longitude?: string;
      deviceId?: string;
      remark?: string;
      recordedById?: string;
    },
  ): Promise<AttendanceEvent> {
    const event = tem.create(AttendanceEvent, {
      company: tem.getReference(Company, input.companyId),
      employee: tem.getReference(Employee, input.employeeId),
      occurredAt: input.occurredAt,
      localDate: input.localDate,
      direction: input.direction,
      source: input.source,
      workLocation: input.verdict.workLocation,
      latitude: input.latitude,
      longitude: input.longitude,
      distanceMeters: input.verdict.distanceMeters,
      geofenceStatus: input.verdict.status,
      deviceId: input.deviceId,
      remark: input.remark,
      recordedBy: input.recordedById ? tem.getReference(AppUser, input.recordedById) : undefined,
      createdAt: new Date(),
    });
    await tem.persistAndFlush(event);
    return event;
  }
}
