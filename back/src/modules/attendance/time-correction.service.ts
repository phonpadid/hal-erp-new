import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { CorrectionKind, DocStatus } from '../../common/enums';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { Document } from '../document/document.entities';
import { Company } from '../multi-company/multi-company.entities';
import { Employee } from '../rbac/rbac.entities';
import { AttendanceEvent, TimeCorrection } from './attendance.entities';
import { localMidnightInstant } from './company-clock';
import {
  EARLY_ARRIVAL_WINDOW_MINUTES,
  LATE_DEPARTURE_WINDOW_MINUTES,
} from './compute-day';
import { ShiftResolutionService } from './shift-resolution.service';
import type { CreateTimeCorrectionDto } from './dto/time-correction.dto';

const FILTER_OFF = { filters: { company: false } } as const;
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

/**
 * Correcting the attendance record.
 *
 * A correction names a PUNCH, never a number. `attendance_day` is a projection: the only way to
 * move it is to move what it derives from and recompute, so there is deliberately no path here
 * that writes worked minutes or a status. Someone who wants Tuesday to say eight hours has to say
 * which punch was wrong.
 *
 * Nothing is inserted into the ledger by this service. It records a REQUEST; approval writes the
 * corrective event. That separation is why the ledger stays trustworthy — a hand-entered punch
 * exists only where someone with the authority to authorise one has done so.
 */
@Injectable()
export class TimeCorrectionService {
  constructor(
    private readonly em: EntityManager,
    private readonly companyScope: CompanyScopeService,
    private readonly resolution: ShiftResolutionService,
  ) {}

  /** Record a correction request against a draft document. */
  async create(dto: CreateTimeCorrectionDto): Promise<TimeCorrection> {
    const companyId = RequestContext.companyId()!;
    const shiftDate = dto.shiftDate.slice(0, 10);
    const em = this.companyScope.forActiveCompany(companyId);

    const document = await em.findOne(Document, { id: dto.documentId });
    if (!document) throw new NotFoundException(`Document ${dto.documentId} not found`);
    if (document.status !== DocStatus.DRAFT) {
      throw new BadRequestException(
        'Correction details can only be set while the document is a draft',
      );
    }
    if (await em.findOne(TimeCorrection, { document: dto.documentId }, FILTER_OFF)) {
      throw new BadRequestException('This document already carries a time correction');
    }

    const employee = await em.findOne(Employee, { id: dto.employeeId });
    if (!employee) throw new BadRequestException(`Unknown employee '${dto.employeeId}'`);

    const { targetEventId, requestedAt, requestedDirection } = this.assertShape(dto);
    await this.assertWithinWindow(em, companyId, shiftDate);

    let target: AttendanceEvent | null = null;
    if (targetEventId) {
      // Scoped find, so an event of another company is not merely rejected — it is not visible.
      target = await em.findOne(AttendanceEvent, { id: targetEventId }, { populate: ['employee'] });
      if (!target) throw new BadRequestException(`Unknown attendance event '${targetEventId}'`);
      if (target.employee.id !== employee.id) {
        throw new BadRequestException(
          'The punch being corrected belongs to a different employee',
        );
      }
      if (
        dto.kind === CorrectionKind.CHANGE &&
        target.occurredAt.getTime() === requestedAt!.getTime() &&
        target.direction === requestedDirection
      ) {
        // Also the guard that keeps a CHANGE distinguishable from a REMOVE: the day computation
        // reads a corrective row that restates its target exactly as a void, so a CHANGE must
        // always move something.
        throw new BadRequestException(
          'This change would record the same instant and direction the punch already has',
        );
      }
    }

    const correction = em.create(TimeCorrection, {
      company: em.getReference(Company, companyId),
      document: em.getReference(Document, dto.documentId),
      employee: em.getReference(Employee, employee.id),
      shiftDate,
      kind: dto.kind,
      targetEvent: target ? em.getReference(AttendanceEvent, target.id) : undefined,
      requestedAt,
      requestedDirection,
      reason: dto.reason,
    });
    await em.persistAndFlush(correction);
    return correction;
  }

  findForDocument(documentId: string): Promise<TimeCorrection | null> {
    const em = this.companyScope.forActiveCompany();
    return em.findOne(
      TimeCorrection,
      { document: documentId },
      { ...FILTER_OFF, populate: ['employee', 'targetEvent'] },
    );
  }

  /**
   * The punches a correction could name for a given shift day.
   *
   * Offered so a requester picks a target rather than describing one by time — a correction that
   * says "the 08:02 one" is a correction that can name the wrong row. Already-superseded punches
   * are excluded: they no longer count, so correcting them would change nothing.
   */
  async correctablePunches(employeeId: string, shiftDate: string): Promise<AttendanceEvent[]> {
    const companyId = RequestContext.companyId()!;
    const date = shiftDate.slice(0, 10);
    const em = this.companyScope.forActiveCompany(companyId);

    const timezone = (await em.findOne(Company, { id: companyId }, FILTER_OFF))?.timezone ?? 'UTC';
    const dayStart = localMidnightInstant(date, timezone);
    const [shift] = await this.resolution.resolveRange(employeeId, date, date);
    const startMinute = (shift?.expectedInMinute ?? 0) - EARLY_ARRIVAL_WINDOW_MINUTES;
    const endMinute = (shift?.expectedOutMinute ?? 1440) + LATE_DEPARTURE_WINDOW_MINUTES;

    const events = await em.find(
      AttendanceEvent,
      {
        employee: employeeId,
        occurredAt: {
          $gte: new Date(dayStart.getTime() + startMinute * MS_PER_MINUTE),
          $lte: new Date(dayStart.getTime() + endMinute * MS_PER_MINUTE),
        },
      },
      { orderBy: { occurredAt: 'ASC' } },
    );
    const superseded = new Set(events.map((e) => e.correctsEvent?.id).filter(Boolean));
    return events.filter((e) => !superseded.has(e.id));
  }

  /** Read the company's window. */
  async window(): Promise<{ correctionWindowDays: number }> {
    const companyId = RequestContext.companyId()!;
    const em = this.companyScope.forActiveCompany(companyId);
    const company = await em.findOneOrFail(Company, { id: companyId }, FILTER_OFF);
    return { correctionWindowDays: company.correctionWindowDays };
  }

  /** Set the company's window. Policy, not a constant — different companies close different months. */
  async setWindow(days: number): Promise<{ correctionWindowDays: number }> {
    const companyId = RequestContext.companyId()!;
    const em = this.companyScope.forActiveCompany(companyId);
    const company = await em.findOneOrFail(Company, { id: companyId }, FILTER_OFF);
    company.correctionWindowDays = days;
    await em.flush();
    return { correctionWindowDays: company.correctionWindowDays };
  }

  /**
   * Which columns each kind requires. A CHANGE with no target is not a strict request that the
   * system could act on cautiously — it is a request with no meaning, so it is refused rather than
   * interpreted.
   */
  private assertShape(dto: CreateTimeCorrectionDto): {
    targetEventId?: string;
    requestedAt?: Date;
    requestedDirection?: CreateTimeCorrectionDto['requestedDirection'];
  } {
    const needsTarget = dto.kind !== CorrectionKind.ADD;
    const needsTime = dto.kind !== CorrectionKind.REMOVE;

    if (needsTarget && !dto.targetEventId) {
      throw new BadRequestException(`A ${dto.kind} correction must name the punch it corrects`);
    }
    if (!needsTarget && dto.targetEventId) {
      throw new BadRequestException(
        'An ADD correction supplies a punch that was never recorded, so it has nothing to supersede',
      );
    }
    if (needsTime && (!dto.requestedAt || !dto.requestedDirection)) {
      throw new BadRequestException(
        `A ${dto.kind} correction must supply the corrected instant and direction`,
      );
    }
    if (!needsTime && (dto.requestedAt || dto.requestedDirection)) {
      throw new BadRequestException(
        'A REMOVE correction voids a punch, so it supplies no instant of its own',
      );
    }

    return {
      targetEventId: dto.targetEventId,
      requestedAt: dto.requestedAt ? new Date(dto.requestedAt) : undefined,
      requestedDirection: dto.requestedDirection,
    };
  }

  /**
   * The window is measured from the SHIFT DAY being corrected, not from the day the request is
   * raised — which is what "you may correct the last 30 days" means to a person. Measuring from
   * the request date would let an old day be reopened simply by raising the request late.
   */
  private async assertWithinWindow(
    em: EntityManager,
    companyId: string,
    shiftDate: string,
  ): Promise<void> {
    const company = await em.findOneOrFail(Company, { id: companyId }, FILTER_OFF);
    const timezone = company.timezone ?? 'UTC';
    const todayLocal = localMidnightInstant(
      new Date().toISOString().slice(0, 10),
      timezone,
    ).getTime();
    const target = localMidnightInstant(shiftDate, timezone).getTime();
    const ageDays = Math.floor((todayLocal - target) / MS_PER_DAY);
    if (ageDays > company.correctionWindowDays) {
      throw new BadRequestException(
        `${shiftDate} is ${ageDays} days old; this company allows corrections up to ` +
          `${company.correctionWindowDays} days back`,
      );
    }
  }
}
