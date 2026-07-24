import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { RequestContext } from '../../common/context/request-context';
import { AttendanceSource, CorrectionKind, GeofenceStatus } from '../../common/enums';
import { Document } from '../document/document.entities';
import { Company } from '../multi-company/multi-company.entities';
import { AppUser, Employee } from '../rbac/rbac.entities';
import { AttendanceDayService } from './attendance-day.service';
import { AttendanceEvent, TimeCorrection } from './attendance.entities';
import { localDateIn } from './company-clock';

const FILTER_OFF = { filters: { company: false } } as const;

/**
 * Approval is what writes a corrective punch.
 *
 * Nothing enters the ledger while a correction is a draft or is being approved: a request to
 * change the record of what happened is not itself a record of what happened. Only full approval
 * inserts the row, and it inserts one — the original stays exactly as it was captured.
 *
 * The inserted row is stamped `recorded_by` = the APPROVING user rather than the requester. A
 * hand-entered punch has to be accountable to whoever had the authority to authorise it; the
 * person who asked is already identifiable through the document. This is the same reasoning the
 * capture slice used when it required `recorded_by` on every MANUAL row.
 *
 * Like the leave listener, this runs on `approval.outcome` — emitted AFTER the approval's
 * transaction commits — so a failure to recompute the projection cannot discard a human decision.
 * The corrective event is inserted here too, and if that insert fails the approval still stands
 * while the failure is logged; the day simply keeps reporting what the uncorrected ledger says,
 * which is the truthful answer for a ledger that did not change.
 */
@Injectable()
export class CorrectionApprovedListener {
  private readonly logger = new Logger(CorrectionApprovedListener.name);

  constructor(
    private readonly em: EntityManager,
    private readonly days: AttendanceDayService,
  ) {}

  @OnEvent('approval.outcome')
  async onOutcome(payload: {
    documentId: string;
    status: string;
    approverId?: string;
  }): Promise<void> {
    if (payload.status !== 'COMPLETED' && payload.status !== 'APPROVED') return;

    const em = this.em.fork();
    const correction = await em.findOne(
      TimeCorrection,
      { document: payload.documentId },
      { ...FILTER_OFF, populate: ['employee', 'targetEvent'] },
    );
    if (!correction) return; // not a correction document

    const document = await em.findOne(Document, { id: payload.documentId }, FILTER_OFF);
    if (!document) return;
    const companyId = document.company.id;

    try {
      await this.insertCorrectiveEvent(em, correction, companyId, payload.approverId);
    } catch (err) {
      this.logger.error(
        `Correction ${payload.documentId} was approved but its corrective punch was not written: ` +
          `${(err as Error).message}. The ledger is unchanged and the day still reflects it.`,
      );
      return; // nothing to recompute — the ledger did not move
    }

    try {
      await RequestContext.run({ companyId, grants: [] }, () =>
        this.days.recomputeDay(correction.employee.id, correction.shiftDate),
      );
    } catch (err) {
      // Swallowed for the reason the leave listener swallows: the approval and the corrective
      // event have already committed, and rethrowing here can only surface as an unhandled
      // rejection. The day stays stale and is findable by comparing `computed_at` to the
      // document's `approved_at`.
      this.logger.error(
        `Correction ${payload.documentId} wrote its punch but ${correction.shiftDate} did not ` +
          `recompute: ${(err as Error).message}`,
      );
    }
  }

  /**
   * One INSERT. Never an UPDATE and never a DELETE — a `REMOVE` is a row that cancels its target
   * rather than a row that disappears, because the ledger cannot delete (invariant 2).
   *
   * A `REMOVE`'s row restates its target's instant and direction exactly. That is what makes it a
   * void: it adds no time of its own, and the day computation drops it alongside the punch it
   * cancels. A `CHANGE` always moves the instant or the direction, so the two never collide.
   */
  private async insertCorrectiveEvent(
    em: EntityManager,
    correction: TimeCorrection,
    companyId: string,
    approverId?: string,
  ): Promise<AttendanceEvent> {
    const target = correction.targetEvent;
    const occurredAt =
      correction.kind === CorrectionKind.REMOVE ? target!.occurredAt : correction.requestedAt!;
    const direction =
      correction.kind === CorrectionKind.REMOVE ? target!.direction : correction.requestedDirection!;

    // A MANUAL punch without an actor is refused by a check constraint from the capture slice, and
    // rightly: the whole point of this row is that somebody stands behind it.
    if (!approverId) {
      throw new Error('The approval outcome carried no approving user to record the punch against');
    }

    const company = await em.findOneOrFail(Company, { id: companyId }, FILTER_OFF);
    const event = em.create(AttendanceEvent, {
      company: em.getReference(Company, companyId),
      employee: em.getReference(Employee, correction.employee.id),
      occurredAt,
      // Stamped from the company clock using the corrective event's OWN instant, exactly as every
      // other insert path does — a correction is not exempt from the timezone the company keeps.
      localDate: localDateIn(occurredAt, company.timezone ?? 'UTC'),
      direction,
      source: AttendanceSource.MANUAL,
      geofenceStatus: GeofenceStatus.UNKNOWN,
      remark: `Correction ${correction.kind}: ${correction.reason}`.slice(0, 500),
      recordedBy: em.getReference(AppUser, approverId),
      correctsEvent: target ? em.getReference(AttendanceEvent, target.id) : undefined,
      createdAt: new Date(),
    });
    await em.persistAndFlush(event);
    return event;
  }
}
