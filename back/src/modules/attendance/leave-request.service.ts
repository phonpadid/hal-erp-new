import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { DocStatus, LeaveHalf } from '../../common/enums';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { Document, DocumentAttachment } from '../document/document.entities';
import { Company, HolidayCalendar } from '../multi-company/multi-company.entities';
import { DocumentSubmitService } from '../document/document-submit.service';
import { Quota } from '../quota/quota.entities';
import { Employee } from '../rbac/rbac.entities';
import { AttendanceDay, LeaveRequest, LeaveType } from './attendance.entities';
import { countLeaveDays, halfForDate, type LeaveDayInput } from './count-leave-days';
import { eachDate, ShiftResolutionService } from './shift-resolution.service';
import type { CreateLeaveRequestDto } from './dto/leave-request.dto';

const FILTER_OFF = { filters: { company: false } } as const;

/** The approved leave covering one date, as the daily projection needs it. */
export interface LeaveCoverage {
  date: string;
  half: LeaveHalf;
  documentId: string;
  quotaId: string;
}

/**
 * Leave requests: the range a person asked for, and how much of it actually costs them.
 *
 * The charge is not the length of the range. A request spanning a public holiday or a shift day
 * off charges less, and a half day charges half of that date's own hours — which is why this
 * service resolves the employee's shift across the range rather than counting dates.
 */
@Injectable()
export class LeaveRequestService {
  constructor(
    private readonly em: EntityManager,
    private readonly companyScope: CompanyScopeService,
    private readonly resolution: ShiftResolutionService,
    private readonly documents: DocumentSubmitService,
  ) {}

  /**
   * Record the request against a draft document and compute what it will charge. The quantity
   * returned here is what the document must reserve at submit — counted once, so what is charged
   * is what was counted.
   */
  async create(dto: CreateLeaveRequestDto): Promise<LeaveRequest> {
    const companyId = RequestContext.companyId()!;
    const em = this.companyScope.forActiveCompany(companyId);

    const fromDate = dto.fromDate.slice(0, 10);
    const toDate = dto.toDate.slice(0, 10);
    if (toDate < fromDate) {
      throw new BadRequestException('The leave end date must not precede its start date');
    }

    const document = await em.findOne(Document, { id: dto.documentId });
    if (!document) throw new NotFoundException(`Document ${dto.documentId} not found`);
    if (document.status !== DocStatus.DRAFT) {
      throw new BadRequestException('Leave details can only be set while the document is a draft');
    }
    const existing = await em.findOne(LeaveRequest, { document: dto.documentId }, FILTER_OFF);
    if (existing) {
      throw new BadRequestException('This document already carries a leave request');
    }

    const quota = await em.findOne(Quota, { id: dto.quotaId });
    if (!quota) throw new BadRequestException(`Unknown leave type '${dto.quotaId}'`);

    // Whose leave it is: the document's related employee when it names one (HR filing on behalf),
    // otherwise the person raising it. The same rule the submit path uses to charge the quota, so
    // the days counted and the entitlement charged always belong to the same person.
    const employee = await this.beneficiaryOf(em, document, companyId);

    const totalDays = (
      await this.countFor(em, employee.id, fromDate, toDate, dto.fromHalf, dto.toHalf)
    ).totalDays;
    if (Number(totalDays) <= 0) {
      throw new BadRequestException(
        'This request covers no working days — there is nothing to charge',
      );
    }

    const leave = em.create(LeaveRequest, {
      document: em.getReference(Document, dto.documentId),
      quota: em.getReference(Quota, dto.quotaId),
      employee: em.getReference(Employee, employee.id),
      fromDate,
      fromHalf: dto.fromHalf ?? LeaveHalf.FULL,
      toDate,
      toHalf: dto.toHalf ?? LeaveHalf.FULL,
      totalDays,
    });
    await em.persistAndFlush(leave);
    return leave;
  }

  /**
   * Submit a leave document. The one entry point through which leave may be submitted at all —
   * its type carries `derives_quantity`, so the generic endpoint refuses it.
   *
   * Every leave-specific rule fires here, before anything is reserved, because they are leave's
   * rules and document-engine (built earlier) cannot import them. The days are RE-COUNTED rather
   * than trusted from creation: a holiday may have been declared or a shift reassigned since, and
   * submit is the moment the charge becomes real — the same reason this system stamps
   * `document.exchange_rate` at submit rather than at draft.
   */
  async submit(documentId: string): Promise<{ documentId: string; totalDays: string }> {
    const companyId = RequestContext.companyId()!;
    const em = this.companyScope.forActiveCompany(companyId);

    const leave = await em.findOne(
      LeaveRequest,
      { document: documentId },
      { ...FILTER_OFF, populate: ['quota', 'employee', 'document'] },
    );
    if (!leave) throw new BadRequestException('This document carries no leave request');

    const config = await em.findOne(LeaveType, { quota: leave.quota.id }, FILTER_OFF);
    this.assertTiming(leave, config);
    await this.assertAttachment(em, leave, config);

    // Re-count: what is charged must be what the world says today, not what it said at draft.
    const recount = await this.countFor(
      em, leave.employee.id, leave.fromDate, leave.toDate, leave.fromHalf, leave.toHalf,
    );
    if (Number(recount.totalDays) <= 0) {
      throw new BadRequestException(
        'This request no longer covers any working days — it charges nothing',
      );
    }
    leave.totalDays = recount.totalDays;
    await em.flush();

    await this.documents.submit(
      documentId,
      {
        quotaReservations: [
          { quotaId: leave.quota.id, qty: recount.totalDays, year: Number(leave.fromDate.slice(0, 4)) },
        ],
      },
      // The claim this option makes is true: the quantity above was just derived, here.
      { quantityAlreadyDerived: true },
    );
    return { documentId, totalDays: recount.totalDays };
  }

  /**
   * Notice and backdating. Measured against the leave's START, which is the date the rule is
   * about — "file three days ahead" means ahead of the absence, not ahead of its last day.
   */
  private assertTiming(leave: LeaveRequest, config: LeaveType | null): void {
    if (!config) return; // an unconfigured type imposes no timing rule
    const today = new Date().toISOString().slice(0, 10);
    const daysBetween = (a: string, b: string) =>
      Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

    const noticeGiven = daysBetween(today, leave.fromDate);
    if (noticeGiven >= 0) {
      if (noticeGiven < config.advanceNoticeDays) {
        throw new BadRequestException(
          `This leave type must be filed at least ${config.advanceNoticeDays} day(s) before it starts`,
        );
      }
      return;
    }
    // Already started: this is a backdated filing.
    const daysLate = -noticeGiven;
    if (daysLate > config.backdateLimitDays) {
      throw new BadRequestException(
        config.backdateLimitDays === 0
          ? 'This leave type cannot be filed for dates that have already started'
          : `This leave type may be filed at most ${config.backdateLimitDays} day(s) after it starts`,
      );
    }
  }

  /**
   * The certificate rule. Counted in CONSECUTIVE calendar days of the request, not in charged
   * days: an illness that spans a weekend is still one long absence, even though the weekend
   * costs no quota.
   */
  private async assertAttachment(
    em: EntityManager,
    leave: LeaveRequest,
    config: LeaveType | null,
  ): Promise<void> {
    const threshold = config?.attachmentRequiredOverDays;
    if (threshold === undefined || threshold === null) return;
    const span =
      Math.round(
        (Date.parse(`${leave.toDate}T00:00:00Z`) - Date.parse(`${leave.fromDate}T00:00:00Z`)) /
          86_400_000,
      ) + 1;
    if (span <= threshold) return;
    const attachments = await em.count(DocumentAttachment, { document: leave.document.id }, FILTER_OFF);
    if (attachments === 0) {
      throw new BadRequestException(
        `A leave of more than ${threshold} consecutive day(s) requires a supporting attachment`,
      );
    }
  }

  /** The request attached to a document, or null. */
  findForDocument(documentId: string): Promise<LeaveRequest | null> {
    const em = this.companyScope.forActiveCompany();
    return em.findOne(LeaveRequest, { document: documentId }, { ...FILTER_OFF, populate: ['quota'] });
  }

  /**
   * Which dates in a range are covered by APPROVED leave for one employee, and by which half.
   *
   * Only approved documents count: a submitted request is a proposal, and a proposal must not
   * excuse an absence. This is the input `computeDay` takes.
   */
  async coverageFor(
    employeeId: string,
    from: string,
    to: string,
    em?: EntityManager,
  ): Promise<Map<string, LeaveCoverage>> {
    const m = em ?? this.companyScope.forActiveCompany();
    const fromDate = from.slice(0, 10);
    const toDate = to.slice(0, 10);

    // Any request that overlaps the window at all, for a document that is approved or completed
    // and belongs to this employee.
    const requests = await m.find(
      LeaveRequest,
      {
        fromDate: { $lte: toDate },
        toDate: { $gte: fromDate },
        employee: employeeId,
        document: { status: { $in: [DocStatus.APPROVED, DocStatus.COMPLETED] } },
      },
      { ...FILTER_OFF, populate: ['document', 'quota'] },
    );

    const coverage = new Map<string, LeaveCoverage>();
    for (const request of requests) {
      for (const date of eachDate(request.fromDate, request.toDate)) {
        if (date < fromDate || date > toDate) continue;
        coverage.set(date, {
          date,
          half: halfForDate(date, request.fromDate, request.toDate, request.fromHalf, request.toHalf),
          documentId: request.document.id,
          quotaId: request.quota.id,
        });
      }
    }
    return coverage;
  }

  /**
   * Approved leave whose days have not caught up: the projection was computed before the leave was
   * approved, or was never computed at all.
   *
   * Needs no stored state and no outbox. `attendance_day.computed_at` was added last slice "so
   * staleness is visible rather than assumed", and `document.approved_at` already existed —
   * comparing them turns out to be exactly the outstanding-work marker this slice needed.
   */
  async staleLeaveDays(): Promise<
    Array<{ employeeId: string; date: string; documentId: string; approvedAt: Date }>
  > {
    const em = this.companyScope.forActiveCompany();
    const requests = await em.find(
      LeaveRequest,
      { document: { status: { $in: [DocStatus.APPROVED, DocStatus.COMPLETED] } } },
      { ...FILTER_OFF, populate: ['document', 'employee'] },
    );

    const stale: Array<{ employeeId: string; date: string; documentId: string; approvedAt: Date }> = [];
    for (const request of requests) {
      const approvedAt = request.document.approvedAt;
      if (!approvedAt) continue;
      const rows = await em.find(
        AttendanceDay,
        {
          employee: request.employee.id,
          shiftDate: { $gte: request.fromDate, $lte: request.toDate },
        },
        FILTER_OFF,
      );
      const computedAt = new Map(rows.map((r) => [r.shiftDate, r.computedAt]));
      for (const date of eachDate(request.fromDate, request.toDate)) {
        const when = computedAt.get(date);
        // Missing entirely, or computed before the approval that should have changed it.
        if (!when || when < approvedAt) {
          stale.push({ employeeId: request.employee.id, date, documentId: request.document.id, approvedAt });
        }
      }
    }
    return stale;
  }

  /** Count a candidate range without storing anything — what a client needs to preview a request. */
  async preview(
    employeeId: string,
    fromDate: string,
    toDate: string,
    fromHalf?: LeaveHalf,
    toHalf?: LeaveHalf,
  ) {
    const em = this.companyScope.forActiveCompany();
    return this.countFor(em, employeeId, fromDate.slice(0, 10), toDate.slice(0, 10), fromHalf, toHalf);
  }

  private async countFor(
    em: EntityManager,
    employeeId: string,
    fromDate: string,
    toDate: string,
    fromHalf?: LeaveHalf,
    toHalf?: LeaveHalf,
  ) {
    const shifts = await this.resolution.resolveRange(employeeId, fromDate, toDate);
    const holidays = new Set(
      (await em.find(HolidayCalendar, { holidayDate: { $gte: fromDate, $lte: toDate } })).map(
        (h) => h.holidayDate,
      ),
    );
    const days: LeaveDayInput[] = [];
    let index = 0;
    for (const date of eachDate(fromDate, toDate)) {
      days.push({ date, shift: shifts[index] ?? null, isHoliday: holidays.has(date) });
      index += 1;
    }
    return countLeaveDays(days, fromHalf ?? LeaveHalf.FULL, toHalf ?? LeaveHalf.FULL);
  }

  private async beneficiaryOf(
    em: EntityManager,
    document: Document,
    companyId: string,
  ): Promise<Employee> {
    const relatedId = document.relatedEmployee?.id;
    if (relatedId) {
      const related = await em.findOne(Employee, { id: relatedId, company: companyId }, FILTER_OFF);
      if (!related) {
        throw new BadRequestException(
          'The related employee on this document does not belong to its company',
        );
      }
      return related;
    }
    const requester = await em.findOne(
      Employee,
      { user: document.createdBy.id, company: companyId },
      FILTER_OFF,
    );
    if (!requester) {
      throw new BadRequestException(
        'Leave needs an employee to charge: this document names none and its creator has no linked employee',
      );
    }
    return requester;
  }
}

export { Company };
