import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { DocStatus } from '../../common/enums';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { inTransaction, lockForUpdate } from '../../common/uow/unit-of-work';
import { DocumentSubmitService } from '../document/document-submit.service';
import { Document } from '../document/document.entities';
import { Company } from '../multi-company/multi-company.entities';
import { Quota } from '../quota/quota.entities';
import { Employee } from '../rbac/rbac.entities';
import { AttendanceDay, OvertimeClaim } from './attendance.entities';
import { isoWeeksBetween } from './iso-week';
import type { CreateOvertimeClaimDto } from './dto/overtime-claim.dto';

const FILTER_OFF = { filters: { company: false } } as const;

/** A claim's hours, kept apart by kind because they are compensated at different rates. */
export interface ClaimableHours {
  otNormalMinutes: number;
  holidayWorkMinutes: number;
  otHolidayMinutes: number;
  totalMinutes: number;
}

/** A document status that still holds its days: anything not withdrawn. */
const LIVE_STATUSES = [
  DocStatus.DRAFT,
  DocStatus.SUBMITTED,
  DocStatus.IN_APPROVAL,
  DocStatus.APPROVED,
  DocStatus.COMPLETED,
];

/**
 * Certifying overtime that has already been worked.
 *
 * The daily projection records overtime as a raw observation. This turns it into a claim — and the
 * hours come from the projection, never from the claimant, which is why the document type carries
 * `derives_quantity` and the generic submit endpoint refuses it.
 *
 * Nothing here writes to `attendance_day`. Whether a day is claimed is answered by relating it to
 * these rows, so the projection stays reproducible from the ledger and configuration alone.
 */
@Injectable()
export class OvertimeClaimService {
  constructor(
    private readonly em: EntityManager,
    private readonly companyScope: CompanyScopeService,
    private readonly documents: DocumentSubmitService,
  ) {}

  /**
   * The overtime recorded across a range, by kind. Never totalled into one figure before it has to
   * be: 1.5x, 2x and 3x are different money, and a sum cannot be taken apart again.
   */
  async claimableFor(
    employeeId: string,
    from: string,
    to: string,
    em?: EntityManager,
  ): Promise<ClaimableHours> {
    const m = em ?? this.companyScope.forActiveCompany();
    const days = await m.find(
      AttendanceDay,
      { employee: employeeId, shiftDate: { $gte: from.slice(0, 10), $lte: to.slice(0, 10) } },
      FILTER_OFF,
    );
    const hours = days.reduce(
      (acc, d) => ({
        otNormalMinutes: acc.otNormalMinutes + d.otNormalMinutes,
        holidayWorkMinutes: acc.holidayWorkMinutes + d.holidayWorkMinutes,
        otHolidayMinutes: acc.otHolidayMinutes + d.otHolidayMinutes,
      }),
      { otNormalMinutes: 0, holidayWorkMinutes: 0, otHolidayMinutes: 0 },
    );
    return {
      ...hours,
      totalMinutes: hours.otNormalMinutes + hours.holidayWorkMinutes + hours.otHolidayMinutes,
    };
  }

  /**
   * Which dates in a range are already covered by a live claim. Derived by relation — `attendance_day`
   * carries no claim reference, because a projection must be rebuildable and a claim id is a fact
   * recomputation could not reproduce.
   */
  async claimedDates(employeeId: string, from: string, to: string): Promise<Set<string>> {
    const em = this.companyScope.forActiveCompany();
    const claims = await this.liveClaimsOverlapping(em, employeeId, from.slice(0, 10), to.slice(0, 10));
    const dates = new Set<string>();
    for (const claim of claims) {
      const cursor = new Date(`${claim.fromDate}T00:00:00Z`);
      const last = new Date(`${claim.toDate}T00:00:00Z`);
      while (cursor <= last) {
        dates.add(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }
    return dates;
  }

  /** Record a certification against a draft document. */
  async create(dto: CreateOvertimeClaimDto): Promise<OvertimeClaim> {
    const companyId = RequestContext.companyId()!;
    const fromDate = dto.fromDate.slice(0, 10);
    const toDate = dto.toDate.slice(0, 10);
    if (toDate < fromDate) {
      throw new BadRequestException('The claim end date must not precede its start date');
    }

    const em = this.companyScope.forActiveCompany(companyId);
    const document = await em.findOne(Document, { id: dto.documentId });
    if (!document) throw new NotFoundException(`Document ${dto.documentId} not found`);
    if (document.status !== DocStatus.DRAFT) {
      throw new BadRequestException('Overtime details can only be set while the document is a draft');
    }
    if (await em.findOne(OvertimeClaim, { document: dto.documentId }, FILTER_OFF)) {
      throw new BadRequestException('This document already carries an overtime claim');
    }

    const employee = await em.findOne(Employee, { id: dto.employeeId });
    if (!employee) throw new BadRequestException(`Unknown employee '${dto.employeeId}'`);

    return inTransaction(em, async (tem) => {
      // Every write to this person's claim timeline serializes here, so the overlap scan below
      // cannot race another claim that has not committed yet — the same read-then-write hazard the
      // three previous slices hit.
      await lockForUpdate(tem, Employee, { id: employee.id }, FILTER_OFF);
      await this.assertNoOverlap(tem, employee.id, fromDate, toDate);

      const hours = await this.claimableFor(employee.id, fromDate, toDate, tem);
      if (hours.totalMinutes <= 0) {
        throw new BadRequestException(
          'These days have no recorded overtime — there is nothing to certify',
        );
      }

      const claim = tem.create(OvertimeClaim, {
        company: tem.getReference(Company, companyId),
        document: tem.getReference(Document, dto.documentId),
        employee: tem.getReference(Employee, employee.id),
        fromDate,
        toDate,
        otNormalMinutes: hours.otNormalMinutes,
        holidayWorkMinutes: hours.holidayWorkMinutes,
        otHolidayMinutes: hours.otHolidayMinutes,
      });
      await tem.persistAndFlush(claim);
      return claim;
    });
  }

  findForDocument(documentId: string): Promise<OvertimeClaim | null> {
    const em = this.companyScope.forActiveCompany();
    return em.findOne(OvertimeClaim, { document: documentId }, { ...FILTER_OFF, populate: ['employee'] });
  }

  /** What a candidate range would certify, without committing to it. */
  preview(employeeId: string, from: string, to: string): Promise<ClaimableHours> {
    return this.claimableFor(employeeId, from, to);
  }

  /**
   * Submit a certification. The only way an overtime document may be submitted: its type carries
   * `derives_quantity`, so the generic endpoint refuses it.
   *
   * Re-sums the days rather than trusting what was recorded at draft, for the same reason leave
   * re-counts: submit is the moment the claim becomes real, and the projection may have been
   * recomputed since.
   */
  async submit(documentId: string): Promise<{ documentId: string; hours: ClaimableHours }> {
    const companyId = RequestContext.companyId()!;
    const em = this.companyScope.forActiveCompany(companyId);

    const claim = await em.findOne(
      OvertimeClaim,
      { document: documentId },
      { ...FILTER_OFF, populate: ['employee'] },
    );
    if (!claim) throw new BadRequestException('This document carries no overtime claim');

    return inTransaction(em, async (tem) => {
      // The ceiling check and the reservation share a transaction, so a claim cannot be reserved
      // against a ceiling a concurrent claim has since consumed.
      await lockForUpdate(tem, Employee, { id: claim.employee.id }, FILTER_OFF);
      await this.assertWeeklyCeiling(tem, companyId, claim.employee.id, claim.fromDate, claim.toDate);

      const hours = await this.claimableFor(claim.employee.id, claim.fromDate, claim.toDate, tem);
      if (hours.totalMinutes <= 0) {
        throw new BadRequestException(
          'These days no longer carry any recorded overtime — there is nothing to certify',
        );
      }
      claim.otNormalMinutes = hours.otNormalMinutes;
      claim.holidayWorkMinutes = hours.holidayWorkMinutes;
      claim.otHolidayMinutes = hours.otHolidayMinutes;
      await tem.flush();

      // An OT quota is a company's OWN optional budget for overtime spending. The statutory
      // ceiling above is what actually binds, so a company that tracks no such quota still claims.
      const otQuota = await tem.findOne(Quota, { company: companyId, quotaType: 'OT_HOURS', isActive: true }, FILTER_OFF);
      const reservations = otQuota
        ? [{ quotaId: otQuota.id, qty: (hours.totalMinutes / 60).toFixed(2), year: Number(claim.fromDate.slice(0, 4)) }]
        : [];

      await this.documents.submit(
        documentId,
        { quotaReservations: reservations },
        // True: the hours were derived from the projection immediately above.
        { quantityAlreadyDerived: true },
      );
      return { documentId, hours };
    });
  }

  /**
   * The statutory weekly ceiling, checked against RECORDED attendance rather than claimed hours.
   *
   * Counting only what was claimed would let an employer stay under the cap by simply not
   * certifying — which is the abuse a cap on working hours exists to prevent. A consequence worth
   * the error message: a modest claim can be refused because of hours elsewhere in the same week.
   */
  private async assertWeeklyCeiling(
    tem: EntityManager,
    companyId: string,
    employeeId: string,
    fromDate: string,
    toDate: string,
  ): Promise<void> {
    const company = await tem.findOne(Company, { id: companyId }, FILTER_OFF);
    const limit = company!.overtimeWeeklyLimitMinutes;

    // Every week the claim touches, not just the first — a range crossing a boundary must satisfy
    // both, and treating it as one week is the off-by-one this loop exists to avoid.
    for (const week of isoWeeksBetween(fromDate, toDate)) {
      const recorded = await this.claimableFor(employeeId, week.from, week.to, tem);
      if (recorded.totalMinutes > limit) {
        throw new BadRequestException(
          `Week ${week.from} to ${week.to} already records ${recorded.totalMinutes} minutes of ` +
            `overtime and holiday work, above the limit of ${limit}. The limit counts hours ` +
            `worked, not hours claimed, so leaving some unclaimed does not lift it.`,
        );
      }
    }
  }

  /**
   * Reject a range meeting an existing live claim for the same employee. A claim awaiting approval
   * blocks too: allowing a second over the same evening would put the same hours in front of two
   * approvers, neither knowing about the other.
   */
  private async assertNoOverlap(
    tem: EntityManager,
    employeeId: string,
    fromDate: string,
    toDate: string,
  ): Promise<void> {
    const clash = (await this.liveClaimsOverlapping(tem, employeeId, fromDate, toDate))[0];
    if (clash) {
      throw new BadRequestException(
        `Overtime for ${clash.fromDate} to ${clash.toDate} has already been claimed on another ` +
          `document; the same hours cannot be certified twice`,
      );
    }
  }

  private liveClaimsOverlapping(
    em: EntityManager,
    employeeId: string,
    fromDate: string,
    toDate: string,
  ): Promise<OvertimeClaim[]> {
    return em.find(
      OvertimeClaim,
      {
        employee: employeeId,
        fromDate: { $lte: toDate },
        toDate: { $gte: fromDate },
        document: { status: { $in: LIVE_STATUSES } },
      },
      { ...FILTER_OFF, populate: ['document'] },
    );
  }
}
